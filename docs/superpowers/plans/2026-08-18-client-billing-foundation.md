# Client Billing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the foundational, independently-testable slice of the client-billing replica — schema, atomic invoice numbering, and proforma-invoice creation — as a new `client-billing` module in `mas_hrms`, without touching the existing `erp`/`billing_invoice` system.

**Architecture:** Three new tables (`client_invoice`, `client_invoice_line`, `client_invoice_number_sequence`) plus a service layer that mints proforma numbers atomically (MySQL `LAST_INSERT_ID()` counter idiom, replacing legacy's broken `LOCK TABLES ... READ` pattern) and creates a proforma invoice with GST-calculated line items, backed by `cost_centre_master`/`branch_master` for client identity and GST/state data. Routes follow the exact `requireAuth`/`requireRole` pattern already used in `erp.routes.ts`.

**Tech Stack:** Express + TypeScript, mysql2, vitest, MySQL 8 (`mas_hrms`).

## Global Constraints

- New tables live in `mas_hrms` only; `db_bill`, `billing_invoice`, and the `billing_*_snapshot` tables are never read or written by this module.
- Client/cost-centre identity is always resolved through `cost_centre_master` (FK `cost_centre_id`), never a denormalized string match — this is what distinguishes the replica from legacy's `cost_center` string-join pattern.
- Invoice numbering must use a real atomic DB operation, never `LOCK TABLES ... READ` (the confirmed legacy race-condition bug).
- GST state code and GSTIN come from `branch_master.gst_state_code` / `cost_centre_master.gst_type`, resolved via `cost_centre_master.branch_id`.
- Every route requires `requireAuth` plus an explicit `requireRole(...)` allow-list — no route ships without both, mirroring `erp.routes.ts`.
- All state-changing routes are `POST`/`PATCH` only — never `GET` (fixes legacy's `reject_invoice()` CSRF-via-GET bug for any future task that adds mutation endpoints on top of this foundation).
- DB access goes through `db` exported from `backend/src/db/mysql.ts` (`db.execute`, `db.getConnection`) — the same import every other module uses.
- Tests use vitest with the existing mock pattern: `vi.mock("../../../db/mysql.js", () => ({ db: { execute } }))`, `vi.hoisted`, dynamic `await import(...)` of the module under test in `beforeAll`.
- Migration files are numbered `NNN_description.sql` under `backend/sql/migrations/`, get a header comment (Why / Safety / Deployment), and are registered as the last entry's neighbor in `backend/sql/MIGRATION_MANIFEST.lock.json` — migrations run automatically at boot (pm2 restart applies the manifest), so registration IS deployment; per CLAUDE.md this repo's non-negotiable rules, the migration is applied to an isolated local/staging schema for verification in this plan, and registering/running it against the shared/production database requires separate explicit user sign-off beyond what this plan covers.

---

## File Structure

- `backend/sql/migrations/431_client_billing_foundation.sql` — new tables (create only; check the manifest tail before using `431` in case another session has claimed it).
- `backend/sql/MIGRATION_MANIFEST.lock.json` — modified, one new entry.
- `backend/src/modules/client-billing/client-billing-numbering.service.ts` — atomic proforma/bill number minting.
- `backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts` — numbering tests.
- `backend/src/modules/client-billing/client-billing.service.ts` — proforma creation (GST calc, line items, invoice insert).
- `backend/src/modules/client-billing/__tests__/client-billing.service.test.ts` — service tests.
- `backend/src/modules/client-billing/client-billing.routes.ts` — `POST /client-billing/proformas`, `GET /client-billing/proformas`, `GET /client-billing/proformas/:id`.
- `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts` — route tests.
- `backend/src/app.ts` — modified, mount the new router.

---

### Task 1: Schema migration

**Files:**
- Create: `backend/sql/migrations/431_client_billing_foundation.sql`
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json`

**Interfaces:**
- Produces: tables `client_invoice_number_sequence(id, kind, scope_key, last_value, updated_at)`, `client_invoice(id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date, description, proforma_no, bill_no, gst_type, apply_gst, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total, created_by, created_at, updated_at, rejected_reason, rejected_by, rejected_at)`, `client_invoice_line(id, invoice_id, line_type, particulars, qty, rate, amount, created_at)` — every later task in this plan (and follow-on plans for approval/credit-notes/PDF/frontend) reads/writes these exact column names.

- [ ] **Step 1: Check the migration manifest tail so the number isn't already claimed**

Run: `cd backend && tail -5 sql/MIGRATION_MANIFEST.lock.json`
Expected: the highest numbered entry is `430_...` or lower. If a `431_...` already exists (another concurrent session claimed it — see CLAUDE.md's concurrent-agent rules), use `432` instead and adjust every reference in this plan's remaining steps accordingly.

- [ ] **Step 2: Write the migration file**

```sql
-- 431_client_billing_foundation.sql
--
-- Foundation schema for the client-billing replica (docs/superpowers/specs/2026-08-18-client-billing-replica-design.md).
-- Creates three new tables only. Does not touch cost_centre_master, branch_master, billing_invoice,
-- or any billing_*_snapshot table.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- Replaces the legacy db_bill/InitialInvoicesController.php proforma-invoice engine with a
-- modern equivalent that keeps the same business rules but fixes the confirmed numbering race
-- condition (legacy used `LOCK TABLES tbl_invoice READ`, which locks the wrong table in the
-- wrong mode and provides no real serialization). This migration lays down:
--   - client_invoice_number_sequence: one row per (kind, scope_key) atomic counter, minted via
--     MySQL's `INSERT ... ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1)`
--     idiom, which is safe under concurrent writers without any explicit locking.
--   - client_invoice / client_invoice_line: the live proforma invoice and its line items.
--
-- Approval-stage fields (bill_no, rejected_*) are included now even though this plan's
-- services only ever write proforma_no — adding them in a later migration would mean a second
-- ALTER TABLE on a table that may already have production rows by then.
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Pure CREATE TABLE — no ALTER of any existing table, no data migration. Server is MySQL 8,
-- so this is safe to run at any time; there is nothing to lock because the tables do not exist
-- yet. Rollback is three DROP TABLEs (line first, for the FK):
--   DROP TABLE client_invoice_line;
--   DROP TABLE client_invoice;
--   DROP TABLE client_invoice_number_sequence;
--
-- ── Deployment ──────────────────────────────────────────────────────────────────────────
-- Verify against an isolated local/staging schema first (see plan Step 3). Registering this
-- file in sql/MIGRATION_MANIFEST.lock.json applies it at the next pm2 restart — do that only
-- with explicit user sign-off, per CLAUDE.md's migration-approval rule.

CREATE TABLE client_invoice_number_sequence (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind         VARCHAR(20)  NOT NULL,           -- 'proforma' | 'bill'
  scope_key    VARCHAR(191) NOT NULL,            -- 'GLOBAL' for proforma; '<stateCode>|<companyName>|<financeYear>' for bill
  last_value   INT          NOT NULL DEFAULT 0,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kind_scope (kind, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE client_invoice (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  cost_centre_id   CHAR(36)     NOT NULL,
  invoice_status   ENUM('proforma','approved','rejected') NOT NULL DEFAULT 'proforma',
  category         VARCHAR(50)  NOT NULL,
  finance_year     VARCHAR(10)  NOT NULL,
  month_label      VARCHAR(10)  NOT NULL,
  invoice_date     DATE         NOT NULL,
  description      VARCHAR(255) NULL,
  proforma_no      VARCHAR(40)  NULL,
  bill_no          VARCHAR(40)  NULL,
  gst_type         VARCHAR(20)  NOT NULL,       -- 'Integrated' | 'Intrastate'
  apply_gst        TINYINT(1)   NOT NULL DEFAULT 1,
  total_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  igst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  cgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  sgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  grand_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by       CHAR(36)     NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  rejected_reason  TEXT         NULL,
  rejected_by      CHAR(36)     NULL,
  rejected_at      DATETIME     NULL,
  KEY idx_ci_cost_centre (cost_centre_id),
  KEY idx_ci_proforma_no (proforma_no),
  KEY idx_ci_bill_no (bill_no),
  CONSTRAINT fk_ci_cost_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE client_invoice_line (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id   CHAR(36)      NOT NULL,
  line_type    ENUM('charge','deduction') NOT NULL DEFAULT 'charge',
  particulars  VARCHAR(255)  NOT NULL,
  qty          DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate         DECIMAL(14,2) NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cil_invoice (invoice_id),
  CONSTRAINT fk_cil_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- [ ] **Step 3: Apply to an isolated local/staging schema and verify**

Run (against a local/staging `mas_hrms` copy only — never production, per CLAUDE.md):
```bash
mysql -h <staging_host> -u <user> -p mas_hrms < backend/sql/migrations/431_client_billing_foundation.sql
```
Expected: no errors. Then verify:
```bash
mysql -h <staging_host> -u <user> -p mas_hrms -e "SHOW TABLES LIKE 'client_invoice%';"
```
Expected output: three rows — `client_invoice`, `client_invoice_line`, `client_invoice_number_sequence`.

- [ ] **Step 4: Register in the migration manifest**

Open `backend/sql/MIGRATION_MANIFEST.lock.json` and add `"431_client_billing_foundation.sql"` alongside the other entries (alphabetical/numeric position doesn't matter per the existing file's own mixed ordering, but keep it near the other `4NN_*` numbered entries for readability). **Do not run this against the shared/production database as part of this task** — registration is deployment, and deployment needs separate explicit sign-off per CLAUDE.md.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/migrations/431_client_billing_foundation.sql backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "feat(client-billing): add foundation schema (invoice, line, number sequence)"
```

---

### Task 2: Atomic invoice numbering service

**Files:**
- Create: `backend/src/modules/client-billing/client-billing-numbering.service.ts`
- Test: `backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts`

**Interfaces:**
- Consumes: `db.execute<ResultSetHeader>(sql, params)` from `backend/src/db/mysql.ts`.
- Produces: `clientBillingNumberingService.mintProformaNumber(stateCode: string): Promise<string>` (returns `"PI/<stateCode>/<n>"`), `clientBillingNumberingService.mintBillNumber(stateCode: string, companyName: string, financeYear: string): Promise<string>` (returns `"<stateCode>-<NN>/<FYshort>"`, `NN` zero-padded to at least 2 digits) — Task 3 consumes `mintProformaNumber` directly; a later plan's approval task will consume `mintBillNumber`.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let clientBillingNumberingService: typeof import("../client-billing-numbering.service.js")["clientBillingNumberingService"];
beforeAll(async () => {
  ({ clientBillingNumberingService } = await import("../client-billing-numbering.service.js"));
});

beforeEach(() => {
  execute.mockReset();
});

describe("mintProformaNumber", () => {
  it("formats as PI/<stateCode>/<n> using the atomic counter's insertId", async () => {
    execute.mockResolvedValueOnce([{ insertId: 7 }, []]);
    const result = await clientBillingNumberingService.mintProformaNumber("09");
    expect(result).toBe("PI/09/7");
  });

  it("scopes the counter row to kind='proforma', scope_key='GLOBAL'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintProformaNumber("09");
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO client_invoice_number_sequence/);
    expect(params).toEqual(["proforma", "GLOBAL"]);
  });
});

describe("mintBillNumber", () => {
  it("formats as <stateCode>-<NN>/<FYshort>, zero-padded below 10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 7 }, []]);
    const result = await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("09-07/26-27");
  });

  it("does not zero-pad at or above 10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 274 }, []]);
    const result = await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("09-274/26-27");
  });

  it("scopes the counter row to kind='bill', scope_key='<stateCode>|<companyName>|<financeYear>'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintBillNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["bill", "09|Mas Callnet India Pvt Ltd|2026-27"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts`
Expected: FAIL — `Cannot find module '../client-billing-numbering.service.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/client-billing/client-billing-numbering.service.ts
import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Atomic counter mint, replacing legacy's `LOCK TABLES tbl_invoice READ` (wrong table, wrong
 * mode, no real serialization — confirmed race condition in the source audit). This uses
 * MySQL's well-known `INSERT ... ON DUPLICATE KEY UPDATE col = LAST_INSERT_ID(col + expr)`
 * idiom: the UNIQUE KEY on (kind, scope_key) makes the whole statement a single atomic
 * read-modify-write at the storage-engine level, and LAST_INSERT_ID(expr) makes the new value
 * retrievable from the statement's own result (`insertId`) with no follow-up SELECT and no
 * explicit transaction/locking required.
 */
async function nextSequenceValue(kind: "proforma" | "bill", scopeKey: string): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO client_invoice_number_sequence (kind, scope_key, last_value, updated_at)
     VALUES (?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1), updated_at = NOW()`,
    [kind, scopeKey]
  );
  return result.insertId;
}

/** Legacy format: `PI/<state_code>/<n>`, a single global counter (matches bill_no_master id=1). */
async function mintProformaNumber(stateCode: string): Promise<string> {
  const n = await nextSequenceValue("proforma", "GLOBAL");
  return `PI/${stateCode}/${n}`;
}

/**
 * Legacy format: `<state_code>-<NN>/<FYshort>`, scoped per (state_code, company_name,
 * finance_year) — matches `MAX(BillNoChange) WHERE finance_year=X AND state_code=Y AND
 * company_name=Z`. Zero-padded to at least 2 digits below 10, matching legacy's
 * `strlen(intval($idx))==1 ? '0'.$idx : $idx`.
 */
async function mintBillNumber(stateCode: string, companyName: string, financeYear: string): Promise<string> {
  const scopeKey = `${stateCode}|${companyName}|${financeYear}`;
  const n = await nextSequenceValue("bill", scopeKey);
  const idx = n < 10 ? `0${n}` : String(n);
  const fyShort = financeYear.slice(2); // "2026-27" -> "26-27", matches legacy substr($f_year1,2,6)
  return `${stateCode}-${idx}/${fyShort}`;
}

export const clientBillingNumberingService = { mintProformaNumber, mintBillNumber };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/client-billing/client-billing-numbering.service.ts backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts
git commit -m "feat(client-billing): add atomic proforma/bill numbering service"
```

---

### Task 3: Proforma creation service (GST calc + line items)

**Files:**
- Create: `backend/src/modules/client-billing/client-billing.service.ts`
- Test: `backend/src/modules/client-billing/__tests__/client-billing.service.test.ts`

**Interfaces:**
- Consumes: `clientBillingNumberingService.mintProformaNumber(stateCode: string): Promise<string>` (Task 2), `db.execute` (`backend/src/db/mysql.ts`).
- Produces: `clientBillingService.createProforma(input: CreateProformaInput): Promise<ProformaResult>` where
  ```typescript
  interface ProformaLineInput { particulars: string; qty: number; rate: number; lineType?: "charge" | "deduction"; }
  interface CreateProformaInput {
    costCentreId: string; category: string; financeYear: string; monthLabel: string;
    invoiceDate: string; description?: string; applyGst?: boolean;
    lines: ProformaLineInput[]; createdBy: string;
  }
  interface ProformaResult {
    id: string; proformaNo: string; totalAmount: number;
    igstAmount: number; cgstAmount: number; sgstAmount: number; grandTotal: number;
  }
  ```
  — Task 4's routes consume `createProforma` directly with this exact signature.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/client-billing/__tests__/client-billing.service.test.ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { mintProformaNumber } = vi.hoisted(() => ({ mintProformaNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintProformaNumber },
}));

let clientBillingService: typeof import("../client-billing.service.js")["clientBillingService"];
beforeAll(async () => {
  ({ clientBillingService } = await import("../client-billing.service.js"));
});

beforeEach(() => {
  execute.mockReset();
  mintProformaNumber.mockReset();
});

/** cost_centre_master + branch_master lookup row the SELECT returns. */
function mockCostCentreLookup(overrides: Partial<{ companyName: string; gstType: string; stateCode: string }> = {}) {
  execute.mockResolvedValueOnce([
    [{ companyName: "Mas Callnet India Pvt Ltd", gstType: "Integrated", stateCode: "09", ...overrides }],
    [],
  ]);
}

describe("createProforma", () => {
  it("rejects an empty line list before touching the database", async () => {
    await expect(
      clientBillingService.createProforma({
        costCentreId: "cc-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [], createdBy: "u-1",
      })
    ).rejects.toThrow("At least one line item is required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("throws when the cost centre does not exist", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(
      clientBillingService.createProforma({
        costCentreId: "missing", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "Seat charge", qty: 1, rate: 30000 }], createdBy: "u-1",
      })
    ).rejects.toThrow("cost_centre_master missing not found");
  });

  it("throws when the cost centre's branch has no GST state code", async () => {
    mockCostCentreLookup({ stateCode: null as unknown as string });
    await expect(
      clientBillingService.createProforma({
        costCentreId: "cc-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "Seat charge", qty: 1, rate: 30000 }], createdBy: "u-1",
      })
    ).rejects.toThrow(/no branch GST state code/);
  });

  it("computes 18% IGST for an Integrated cost centre and mints/saves the proforma", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7971");
    execute.mockResolvedValueOnce([{}, []]); // invoice INSERT
    execute.mockResolvedValueOnce([{}, []]); // line INSERT

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [{ particulars: "OB Dedicated Seat 1", qty: 1, rate: 30000 }], createdBy: "u-1",
    });

    expect(mintProformaNumber).toHaveBeenCalledWith("09");
    expect(result).toEqual({
      id: expect.any(String), proformaNo: "PI/09/7971",
      totalAmount: 30000, igstAmount: 5400, cgstAmount: 0, sgstAmount: 0, grandTotal: 35400,
    });
  });

  it("computes 9%+9% CGST/SGST for an Intrastate cost centre", async () => {
    mockCostCentreLookup({ gstType: "Intrastate", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7972");
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [{ particulars: "Email ticket creation service", qty: 1, rate: 4678 }], createdBy: "u-1",
    });

    expect(result).toEqual({
      id: expect.any(String), proformaNo: "PI/09/7972",
      totalAmount: 4678, igstAmount: 0, cgstAmount: 421.02, sgstAmount: 421.02, grandTotal: 5520.04,
    });
  });

  it("subtracts deduction lines from the taxable total", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7973");
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [
        { particulars: "Base charge", qty: 1, rate: 10000 },
        { particulars: "Waiver", qty: 1, rate: 1000, lineType: "deduction" },
      ],
      createdBy: "u-1",
    });

    expect(result.totalAmount).toBe(9000);
    expect(result.igstAmount).toBe(1620);
  });

  it("skips GST entirely when applyGst is false", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7974");
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18", applyGst: false,
      lines: [{ particulars: "Base charge", qty: 1, rate: 10000 }], createdBy: "u-1",
    });

    expect(result).toMatchObject({ igstAmount: 0, cgstAmount: 0, sgstAmount: 0, grandTotal: 10000 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing.service.test.ts`
Expected: FAIL — `Cannot find module '../client-billing.service.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/client-billing/client-billing.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";

export interface ProformaLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: "charge" | "deduction";
}

export interface CreateProformaInput {
  costCentreId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  invoiceDate: string; // YYYY-MM-DD
  description?: string;
  applyGst?: boolean;
  lines: ProformaLineInput[];
  createdBy: string;
}

export interface ProformaResult {
  id: string;
  proformaNo: string;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Matches legacy's tax_call block: 18% for an Integrated (inter-state) cost centre, or
 * 9%+9% CGST/SGST split for an Intrastate one. Skipped entirely when applyGst is false.
 */
function computeGst(baseAmount: number, gstType: string, applyGst: boolean) {
  if (!applyGst) return { igst: 0, cgst: 0, sgst: 0 };
  if (gstType === "Integrated") {
    return { igst: round2(baseAmount * 0.18), cgst: 0, sgst: 0 };
  }
  const half = round2(baseAmount * 0.09);
  return { igst: 0, cgst: half, sgst: half };
}

async function createProforma(input: CreateProformaInput): Promise<ProformaResult> {
  if (input.lines.length === 0) {
    throw new Error("At least one line item is required");
  }

  const [costCentreRows] = await db.execute<RowDataPacket[]>(
    `SELECT cc.company_name AS companyName, cc.gst_type AS gstType, b.gst_state_code AS stateCode
     FROM cost_centre_master cc
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     WHERE cc.id = ?`,
    [input.costCentreId]
  );
  const costCentre = costCentreRows[0] as { companyName: string; gstType: string; stateCode: string | null } | undefined;
  if (!costCentre) {
    throw new Error(`cost_centre_master ${input.costCentreId} not found`);
  }
  if (!costCentre.stateCode) {
    throw new Error(`cost centre ${input.costCentreId} has no branch GST state code — cannot mint a proforma number`);
  }

  const applyGst = input.applyGst ?? true;
  const totalAmount = round2(
    input.lines.reduce((sum, line) => {
      const amount = round2(line.qty * line.rate);
      return line.lineType === "deduction" ? sum - amount : sum + amount;
    }, 0)
  );
  const { igst, cgst, sgst } = computeGst(totalAmount, costCentre.gstType, applyGst);
  const grandTotal = round2(totalAmount + igst + cgst + sgst);

  const proformaNo = await clientBillingNumberingService.mintProformaNumber(costCentre.stateCode);

  const invoiceId = randomUUID();
  await db.execute(
    `INSERT INTO client_invoice
       (id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date,
        description, proforma_no, gst_type, apply_gst, total_amount, igst_amount, cgst_amount,
        sgst_amount, grand_total, created_by)
     VALUES (?, ?, 'proforma', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invoiceId, input.costCentreId, input.category, input.financeYear, input.monthLabel,
      input.invoiceDate, input.description ?? null, proformaNo, costCentre.gstType,
      applyGst ? 1 : 0, totalAmount, igst, cgst, sgst, grandTotal, input.createdBy,
    ]
  );

  for (const line of input.lines) {
    await db.execute(
      `INSERT INTO client_invoice_line (id, invoice_id, line_type, particulars, qty, rate, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), invoiceId, line.lineType ?? "charge", line.particulars, line.qty, line.rate, round2(line.qty * line.rate)]
    );
  }

  return { id: invoiceId, proformaNo, totalAmount, igstAmount: igst, cgstAmount: cgst, sgstAmount: sgst, grandTotal };
}

export const clientBillingService = { createProforma };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing.service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/client-billing/client-billing.service.ts backend/src/modules/client-billing/__tests__/client-billing.service.test.ts
git commit -m "feat(client-billing): add proforma creation service with GST calc"
```

---

### Task 4: Routes

**Files:**
- Create: `backend/src/modules/client-billing/client-billing.routes.ts`
- Test: `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `clientBillingService.createProforma` (Task 3), `requireAuth`/`requireRole`/`AuthenticatedRequest` from `backend/src/middleware/authMiddleware.js` and `backend/src/middleware/requireRole.js` (existing, same imports as `erp.routes.ts`), `db.execute` for the two read routes.
- Produces: `clientBillingRouter` (Express `Router`), mounted at `/api/client-billing` in `app.ts` — exported for any later plan (approval routes, credit-note routes) to extend in the same file.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts
import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createProforma } = vi.hoisted(() => ({ createProforma: vi.fn() }));
vi.mock("../client-billing.service.js", () => ({
  clientBillingService: { createProforma },
}));

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u-1", email: "finance@teammas.in", role: "finance", isDemo: false };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

let clientBillingRouter: typeof import("../client-billing.routes.js")["clientBillingRouter"];
let app: express.Express;

beforeAll(async () => {
  ({ clientBillingRouter } = await import("../client-billing.routes.js"));
  app = express();
  app.use(express.json());
  app.use("/api/client-billing", clientBillingRouter);
});

beforeEach(() => {
  createProforma.mockReset();
  execute.mockReset();
});

describe("POST /api/client-billing/proformas", () => {
  it("creates a proforma and returns 201 with the result", async () => {
    createProforma.mockResolvedValueOnce({
      id: "inv-1", proformaNo: "PI/09/7971", totalAmount: 30000,
      igstAmount: 5400, cgstAmount: 0, sgstAmount: 0, grandTotal: 35400,
    });

    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({
        costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "OB Dedicated Seat 1", qty: 1, rate: 30000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ proformaNo: "PI/09/7971" }) });
    expect(createProforma).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "u-1" }));
  });

  it("returns 400 when costCentreId is missing", async () => {
    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({ category: "Non Subscription", financeYear: "2026-27", monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [] });

    expect(res.status).toBe(400);
    expect(createProforma).not.toHaveBeenCalled();
  });

  it("returns 400 when the service rejects an empty line list", async () => {
    createProforma.mockRejectedValueOnce(new Error("At least one line item is required"));

    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({ costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27", monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/At least one line item is required/);
  });
});

describe("GET /api/client-billing/proformas", () => {
  it("lists invoices", async () => {
    execute.mockResolvedValueOnce([[{ id: "inv-1", proforma_no: "PI/09/7971" }], []]);
    const res = await request(app).get("/api/client-billing/proformas");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: "inv-1", proforma_no: "PI/09/7971" }] });
  });
});

describe("GET /api/client-billing/proformas/:id", () => {
  it("returns 404 when the invoice does not exist", async () => {
    execute.mockResolvedValueOnce([[], []]);
    const res = await request(app).get("/api/client-billing/proformas/missing");
    expect(res.status).toBe(404);
  });

  it("returns the invoice with its lines when found", async () => {
    execute.mockResolvedValueOnce([[{ id: "inv-1", proforma_no: "PI/09/7971" }], []]);
    execute.mockResolvedValueOnce([[{ id: "line-1", particulars: "OB Dedicated Seat 1" }], []]);
    const res = await request(app).get("/api/client-billing/proformas/inv-1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: "inv-1", proforma_no: "PI/09/7971",
      lines: [{ id: "line-1", particulars: "OB Dedicated Seat 1" }],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing.routes.test.ts`
Expected: FAIL — `Cannot find module '../client-billing.routes.js'`. (If `supertest` is not already a devDependency, check `backend/package.json` first — `erp.routes.ts` has no existing route-level supertest test to copy from, so confirm the package is available; if missing, add it: `cd backend && npm install --save-dev supertest @types/supertest` before re-running.)

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/client-billing/client-billing.routes.ts
import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { clientBillingService } from "./client-billing.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

router.use(requireAuth);

const ALLOWED_ROLES = ["admin", "finance", "finance_head", "accounts_head"];

router.post(
  "/proformas",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      costCentreId?: string; category?: string; financeYear?: string; monthLabel?: string;
      invoiceDate?: string; description?: string; applyGst?: boolean;
      lines?: Array<{ particulars: string; qty: number; rate: number; lineType?: "charge" | "deduction" }>;
    };
    if (!body.costCentreId || !body.category || !body.financeYear || !body.monthLabel || !body.invoiceDate) {
      return res.status(400).json({ error: "costCentreId, category, financeYear, monthLabel, and invoiceDate are required" });
    }
    try {
      const data = await clientBillingService.createProforma({
        costCentreId: body.costCentreId,
        category: body.category,
        financeYear: body.financeYear,
        monthLabel: body.monthLabel,
        invoiceDate: body.invoiceDate,
        description: body.description,
        applyGst: body.applyGst,
        lines: body.lines ?? [],
        createdBy: req.authUser!.id,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create proforma" });
    }
  })
);

router.get(
  "/proformas",
  requireRole(...ALLOWED_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows });
  })
);

router.get(
  "/proformas/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [invoiceRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    const invoice = invoiceRows[0];
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_line WHERE invoice_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...invoice, lines: lineRows } });
  })
);

export { router as clientBillingRouter };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing.routes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mount the router in app.ts**

Find the existing ERP mount point:
```bash
grep -n "erpRouter" backend/src/app.ts
```
Next to the existing `import { erpRouter } from "./modules/erp/erp.routes.js";` line, add:
```typescript
import { clientBillingRouter } from "./modules/client-billing/client-billing.routes.js";
```
Next to the existing `app.use("/api/erp", erpRouter);` (or equivalent) line, add:
```typescript
app.use("/api/client-billing", clientBillingRouter);
```

- [ ] **Step 6: Verify the backend still builds and the full test file set passes**

Run: `cd backend && npx tsc --noEmit -p . 2>&1 | grep -i client-billing`
Expected: no output (no type errors in the new files). **Do not run a full unscoped `tsc` across the whole backend** — per this repo's existing orphan-error baseline, a full-project typecheck surfaces long-standing unrelated errors; grep-filtering to this module's own files is the correct scope check here.

Run: `cd backend && npx vitest run src/modules/client-billing`
Expected: PASS, all 18 tests across the three test files in this module.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/client-billing/client-billing.routes.ts backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts backend/src/app.ts
git commit -m "feat(client-billing): add proforma routes and mount in app.ts"
```

---

## What this plan does NOT cover (follow-on plans)

Per the approved design spec (`docs/superpowers/specs/2026-08-18-client-billing-replica-design.md`), the following are separate, later plans — each producing its own independently testable slice:

1. **Approval workflow** — `mintBillNumber` consumer, `client_provision`/`client_provision_deduction`/`client_po_number`/`client_po_particular` tables, the proforma→approved→rejected state transitions, `client_invoice_audit_log`.
2. **Credit notes** — `client_credit_note`/`client_credit_note_line` tables and service, reusing the same numbering-service pattern with a dedicated sequence kind.
3. **PDF generation** — server-rendered proforma/bill PDF matching the legacy layout (reference: legacy `view_pdf()`, invoice id 11724).
4. **Frontend** — React screens under ui-ux-pro-max (proforma creation form, approval queue, invoice list/detail, PDF preview, credit-note flow).
5. **Migration/cutover** — fresh historical pull from live `db_bill`, sequence-counter seeding from live `MAX()` values at cutover.

---

## Self-Review

**Spec coverage:** This plan implements design spec §4 (`client_invoice`, `client_invoice_line`, `client_invoice_number_sequence` — the three tables in scope for this phase), §2.1's numbering-scheme replication (Proforma Number format, exactly matched including zero-padding and FY-short-string slicing), and the GST calc from §2.1/§5 (18% integrated / 9%+9% intrastate). Approval, provision/PO, credit notes, PDF, frontend, and migration are explicitly out of scope for this plan (see previous section) and were never silently dropped.

**Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code; the one open item (migration number `431` possibly being claimed by a concurrent session) has a concrete resolution step (check the manifest tail, use `432` if needed), not a vague caveat.

**Type consistency:** `ProformaResult`/`CreateProformaInput`/`ProformaLineInput` (Task 3) match exactly what Task 4's routes construct and destructure. `clientBillingNumberingService.mintProformaNumber(stateCode: string)` (Task 2) matches the call site in Task 3's `createProforma`. Column names in the Task 1 migration (`proforma_no`, `cost_centre_id`, `invoice_status`, etc.) match every SQL string in Tasks 3–4 exactly.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-18-client-billing-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
