# Client Billing — Approval Workflow Design

Status: Approved for planning
Date: 2026-08-19
Author: Claude (session with shivam.giri@teammas.in)

## 1. Purpose

Extend the client-billing foundation (`docs/superpowers/plans/2026-08-18-client-billing-foundation.md`,
implemented and live on `origin/main`) with the second stage of the invoice
lifecycle: taking a `proforma` invoice to `approved` (a real, numbered bill)
or `rejected`. This is the direct continuation of the foundation — the
numbering service's `mintBillNumber` was built and tested in that phase but
has had zero callers until now; this plan gives it one.

## 2. What already exists (do not rebuild)

- `client_invoice` / `client_invoice_line` — live, with `bill_no`,
  `rejected_reason`, `rejected_by`, `rejected_at` columns already present
  but unwritten (deliberate forward-provisioning from the foundation
  migration, confirmed intentional in the whole-branch review).
- `client_invoice_number_sequence` + `clientBillingNumberingService` —
  live, `mintBillNumber(stateCode, companyName, financeYear)` tested and
  correct (fixed post-launch: composite `(kind, scope_key)` primary key,
  no surrogate id — see the migration's own header comment for why a
  surrogate id there is a landmine, do not reintroduce one on any new
  table built in this plan without the same scrutiny).
- `clientBillingService.createProforma` — live, transactional pattern to
  copy for the new services in this plan.
- `client-billing.routes.ts` — live, `requireAuth`/`requireRole`/error-
  handling pattern (`Object.assign(new Error(...), {statusCode})`,
  letting errors flow to the shared `errorHandler` via `h()`) to follow
  exactly for the new routes.

## 3. Scope decision (confirmed with user)

Provision and PO balances are read/decremented by this plan's approval
logic, but **no create/list endpoints for provision or PO data are built
here**. Real provision/PO data arrives with the historical cutover
(design spec §10, a separate later plan); until then these tables are
empty and approval simply finds no provision/PO to draw against, which is
correct pre-cutover behavior, not a bug. This keeps this plan's shape
matching the foundation phase: schema + business logic, not data-entry UI.

## 4. New tables

All `COLLATE=utf8mb4_unicode_ci` at the table level from the start — no
per-column override needed, learned the hard way in the foundation phase.
No surrogate `AUTO_INCREMENT` id on any table whose row is looked up by a
natural/composite key and needs `INSERT ... ON DUPLICATE KEY UPDATE`
semantics (none of these four need that pattern, but the rule stands for
any future table in this codebase).

- **`client_provision`** — `id CHAR(36) PK`, `cost_centre_id CHAR(36)` FK
  to `cost_centre_master`, `finance_year VARCHAR(10)`, `month_label
  VARCHAR(10)`, `provision_amount DECIMAL(14,2)`, `provision_balance
  DECIMAL(14,2)`, timestamps. One row per (cost centre, finance year,
  month).
- **`client_provision_deduction`** — `id CHAR(36) PK`, `provision_id
  CHAR(36)` FK, `invoice_id CHAR(36)` FK to `client_invoice`, `amount_used
  DECIMAL(14,2)`, `deducted_at DATETIME`. One row per invoice's draw
  against one provision month — this is what makes the refund-on-reject
  correct and auditable (find the deduction row, add its `amount_used`
  back to the provision's balance, delete or flag the deduction row —
  not legacy's blind arithmetic on a single balance field).
- **`client_po_number`** — `id CHAR(36) PK`, `cost_centre_id CHAR(36)`
  FK, `po_number VARCHAR(60)`, `period_from DATE`, `period_to DATE`,
  `total_amount DECIMAL(14,2)`, `balance_amount DECIMAL(14,2)`,
  timestamps.
- **`client_po_particular`** — `id CHAR(36) PK`, `po_id CHAR(36)` FK,
  `invoice_id CHAR(36)` FK, `amount_consumed DECIMAL(14,2)`,
  `consumed_at DATETIME`. Same auditability reasoning as the provision
  deduction table.
- **`client_invoice_audit_log`** — `id CHAR(36) PK`, `invoice_id CHAR(36)`
  FK, `action ENUM('created','edited','approved','rejected')`, `actor_id
  CHAR(36)`, `reason TEXT NULL` (required by the service for `rejected`,
  optional otherwise), `created_at DATETIME`. Replaces legacy's four
  inconsistent reject mechanisms (soft-delete via `update_proforma`,
  hard-delete via `update_bill`, soft-delete via `reject_invoice`, and a
  fourth, fully dead endpoint) with exactly one auditable path.

## 5. Services

### `approveInvoice(invoiceId, { poNumbers?, userId })`

Transactional (`db.getConnection()`, same pattern as `createProforma`):
1. Load the invoice; refuse if `invoice_status !== 'proforma'` (idempotency
   guard — matches legacy's `BillNoChange != 0` check, done correctly this
   time with an explicit status enum instead of overloading a numeric
   field).
2. If `poNumbers` supplied (max 4, matching legacy's own cap — a real
   business rule, not a bug): validate each against `client_po_number`,
   sum `balance_amount`, refuse with a clear `statusCode: 400` if
   insufficient — matching legacy's intent, fixed to actually be atomic
   and race-free (real transaction, not `LOCK TABLES`).
3. Mint the bill number: `mintBillNumber(stateCode, companyName,
   financeYear)` — already built, already tested.
4. Copy the frozen cost-centre snapshot columns onto the invoice (same
   ~34-field copy legacy did at this exact stage) — one INSERT, no
   per-column special-casing.
5. Decrement `client_po_number.balance_amount` for each PO used, insert
   `client_po_particular` rows.
6. Update `client_invoice`: `invoice_status='approved'`, `bill_no=...`.
7. Insert one `client_invoice_audit_log` row, `action='approved'`.
8. Commit.

### `rejectInvoice(invoiceId, { reason, userId })`

Same transactional shape:
1. Load the invoice; refuse if already `rejected`.
2. `reason` is required — `statusCode: 400` if missing or empty (fixes
   legacy's GET-triggered, reason-less reject).
3. For every `client_provision_deduction` row tied to this invoice: add
   `amount_used` back onto the linked `client_provision.provision_balance`
   via atomic SQL (`balance = balance + ?`), then delete or flag the
   deduction row. This is the actual fix for legacy's broken refund (which
   overwrote the balance with just the total instead of adding it back).
4. Update `client_invoice`: `invoice_status='rejected'`,
   `rejected_reason`, `rejected_by`, `rejected_at`.
5. Insert one `client_invoice_audit_log` row, `action='rejected'`,
   carrying the reason.
6. Commit.

No hard delete anywhere in this plan — legacy's `update_bill()` reject
branch (hard `DELETE`) is not replicated; one soft, audited path only, per
the bug-fidelity decision already made for the foundation phase (fix all
bugs, keep the business rules).

## 6. Routes

Following `client-billing.routes.ts`'s existing pattern exactly
(`requireAuth` + explicit `requireRole`, POST-only for mutations, errors
flow to the shared `errorHandler` via `Object.assign(new Error(...),
{statusCode})`, never a local try/catch that masks unexpected failures):

- `POST /api/client-billing/invoices/:id/approve` — body: `{ poNumbers?:
  string[] }`.
- `POST /api/client-billing/invoices/:id/reject` — body: `{ reason:
  string }`.
- `GET /api/client-billing/invoices/:id/audit-log` — list audit rows for
  one invoice.

## 7. Testing discipline (new, learned from the foundation phase incident)

Every task's implementer must verify its SQL against a real MySQL 8
connection before reporting done — not only against the mocked
`db.execute` test suite. The foundation phase shipped a migration that
failed twice in production (`last_value` is a MySQL 8.0 reserved word)
and a numbering-service bug that survived two rounds of review (a
surrogate `AUTO_INCREMENT` id silently breaking the `LAST_INSERT_ID(expr)`
idiom) — both invisible to mocks, both caught only when tested live.
Each task's plan brief will require: (a) a live `PREPARE`-based syntax
check of any new DDL/DML before committing, (b) for any new atomic-counter
or upsert-style SQL, an end-to-end check against a throwaway table proving
the returned value is what the code actually expects, not just that the
statement executes without error.

## 8. Out of scope for this plan

- Provision/PO create or list endpoints (§3).
- Editing an approved invoice (legacy's `update_invoice` — a separate,
  later concern if needed at all, given `update_invoice` was legacy's
  single largest source of bugs: undefined-variable provision corruption,
  a lost-refund-on-cost-centre-change gap, a leaked debug `echo`).
- Credit notes, PDF generation, frontend, and historical cutover — all
  remain separate follow-on plans per the foundation design spec.

## Self-review

**Placeholder scan**: none — every section has concrete column
names/types/statuses.
**Internal consistency**: reject's provision refund (§5) matches the
`client_provision_deduction` table design (§4) exactly — the fix depends
on that table existing, which it does in this same plan.
**Scope check**: one cohesive lifecycle stage (approve/reject), matches
one implementation plan sized like the foundation phase (4-5 tasks).
**Ambiguity check**: "no hard delete" is stated explicitly against
legacy's actual behavior so it can't be misread as an oversight.
