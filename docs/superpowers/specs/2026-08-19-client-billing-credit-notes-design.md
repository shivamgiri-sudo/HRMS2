# Client Billing — Credit Notes Design

Status: Approved for planning (user unavailable ~6hrs, standing authorization to continue building per this session's explicit direction)
Date: 2026-08-19
Author: Claude (session with shivam.giri@teammas.in)

## 1. Purpose

Third phase of the client-billing replica. Legacy's `tbl_credit_note` /
`credit_particulars` (db_bill) is a real, actively-used feature — 144
credit notes, most recent created 2026-08-18 — that issues a credit
against an already-approved invoice (reversing all or part of a billed
amount). Confirmed live: `credit_no` is generated as `DD-MM/FY-FY` (a
date stamp, not a sequence) and genuinely collides — ids 163 and 164,
created the same day, both carry `credit_no = "18-08/26-27"`. This is
exactly the numbering-collision bug class the foundation phase already
fixed for invoices; credit notes get the same fix.

No legacy PHP controller for this feature was in the available source
dump (only schema + live data), so the lifecycle below is reconstructed
from the schema's own shape (a `credit_approve`/`status` pair matching
the same create→approve pattern already seen in invoices) and confirmed
against live data, not assumed.

## 2. What already exists (reuse, don't rebuild)

- `client_invoice` — a credit note references an **approved** invoice
  (`invoice_status='approved'`, has a real `bill_no`) via a real FK,
  replacing legacy's `proforma_bill_no` column, which despite its name
  actually stores the referenced invoice's real **bill number**
  (confirmed live: `"09-155/26-27"`, `"09-213/26-27"` — bill-number
  shaped, not proforma-number shaped — a legacy field-name/reality
  mismatch not to replicate literally).
- `clientBillingNumberingService` — extended with a third `kind`
  (`'credit_note'`), reusing the exact same atomic
  `INSERT...ON DUPLICATE KEY UPDATE...LAST_INSERT_ID()` counter this
  session already fixed twice (no surrogate `AUTO_INCREMENT` id — the
  `client_invoice_number_sequence` table already has none, confirmed
  safe for a third `kind` value against the same table).
- `client-billing.routes.ts` conventions: `requireAuth`+`requireRole`,
  `Object.assign(new Error(...), {statusCode})`, no route-local
  try/catch, `db.getConnection()` transactional pattern.

## 3. Numbering (the actual fix for the confirmed legacy bug)

Legacy's `credit_no` format (`DD-MM/FY-FY`) is a date stamp, not an
identity — two notes issued the same day always collide. New format:
`CN-<stateCode>-<NN>/<FYshort>`, scoped per `(stateCode, companyName,
financeYear)` — same scoping shape as `mintBillNumber`, same zero-pad
rule, but with a `CN-` prefix so it's never visually confusable with an
invoice's `bill_no` even though both share the state-code/FY shape.
State code and company name are resolved the same way `createProforma`
already resolves them (`cost_centre_master` → `branch_master`), using
the credited invoice's own `cost_centre_id` — not a fresh lookup input,
since a credit note is always issued against a specific existing
invoice and must use *that* invoice's identity, not an arbitrary one.

Minted once, at credit-note **creation** — unlike invoices (two-stage:
`proforma_no` at create, `bill_no` at approve), legacy's credit note gets
its (broken) number at creation and only a separate `credit_approve`
flag toggles afterward, no renumbering. The new system keeps that
one-stage shape: `credit_no` is minted at creation, approval only flips
status and stamps `approved_by`/`approved_at`.

## 4. New tables

`COLLATE=utf8mb4_unicode_ci` at the table level, no surrogate
`AUTO_INCREMENT` ids (neither table needs upsert semantics), `IF NOT
EXISTS`, FK collations matched to what they reference — all per the
foundation phase's established discipline.

- **`client_credit_note`** — `id CHAR(36) PK`, `invoice_id CHAR(36)` FK
  to `client_invoice` (the invoice being credited — replaces legacy's
  misleadingly-named `proforma_bill_no` string field with a real FK),
  `cost_centre_id CHAR(36)` FK to `cost_centre_master` (denormalized
  from the invoice for query convenience, same identity the invoice
  itself carries — not an independent source of truth), `category
  VARCHAR(50)`, `finance_year VARCHAR(10)`, `month_label VARCHAR(10)`,
  `credit_date DATE`, `description VARCHAR(255) NULL`, `credit_no
  VARCHAR(40)`, `credit_status ENUM('draft','approved') NOT NULL
  DEFAULT 'draft'`, `gst_type VARCHAR(20)`, `apply_gst TINYINT(1)`,
  `total_amount DECIMAL(14,2)`, `igst_amount/cgst_amount/sgst_amount/grand_total
  DECIMAL(14,2)`, `approved_by CHAR(36) NULL`, `approved_at DATETIME
  NULL`, `created_by CHAR(36)`, `created_at DATETIME`.
- **`client_credit_note_line`** — `id CHAR(36) PK`, `credit_note_id
  CHAR(36)` FK, `particulars VARCHAR(255)`, `qty DECIMAL(10,2)`, `rate
  DECIMAL(14,2)`, `amount DECIMAL(14,2)`.

## 5. Services

### `createCreditNote(input)`
Transactional (`db.getConnection()`, same pattern as `createProforma`):
validates the referenced `invoice_id` exists and is `invoice_status =
'approved'` (a credit note can only be issued against a real, billed
invoice — refusing on `proforma`/`rejected` with a clear `statusCode:
400`), computes GST on the line total (same `computeGst` shape as
invoices — 18% integrated / 9%+9% intrastate), mints `credit_no` via
`clientBillingNumberingService.mintCreditNoteNumber(stateCode,
companyName, financeYear)` (new method, same shape as `mintBillNumber`),
inserts the credit note + line rows, `credit_status='draft'`.

### `approveCreditNote(id, userId)`
Transactional, `FOR UPDATE` on the credit-note row (same race-protection
pattern Task 3 of the approval-workflow plan proved live): refuses if
already `approved`, sets `credit_status='approved'`,
`approved_by`/`approved_at`. No provision/PO interaction — legacy's
credit notes don't touch either subsystem (confirmed: neither
`credit_particulars` nor `tbl_credit_note` references
`provision_master` or `po_number` anywhere in the schema), so this
stays deliberately simpler than `approveInvoice`.

## 6. Routes
`POST /api/client-billing/credit-notes` (create, draft),
`POST /api/client-billing/credit-notes/:id/approve`,
`GET /api/client-billing/credit-notes`,
`GET /api/client-billing/credit-notes/:id`
— same `requireAuth`/`requireRole`/error-handling conventions as every
other route in this module.

## 7. Out of scope
- Rejecting/voiding a credit note — legacy has no such mechanism for
  credit notes (unlike invoices' 4 inconsistent reject paths), and
  nothing in the live schema suggests one exists; not inventing one.
- Auto-generating a credit note from an invoice edit/dispute flow —
  legacy's credit notes are manually created by staff; no automation to
  replicate.
- PDF output for credit notes — bundled with the general PDF plan.

## Self-review
**Placeholder scan**: none. **Internal consistency**: the one-stage
numbering (mint-at-create) is stated once and used consistently in both
§3 and §5. **Scope check**: one cohesive lifecycle (create→approve, no
reject), sized like a single implementation plan. **Ambiguity check**:
explicitly stated that `cost_centre_id` on the credit note is
denormalized from the invoice, not an independent input, so a future
reader can't mistake it for an arbitrary user-supplied field.
