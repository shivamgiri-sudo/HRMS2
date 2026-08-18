# Client Billing (Legacy db_bill Invoice Replica) — Design

Status: Approved for planning
Date: 2026-08-18
Author: Claude (session with shivam.giri@teammas.in)

## 1. Purpose

Replace the legacy PHP/CakePHP client-invoicing system running against `db_bill`
(MySQL 5.5, host `ubuntu-14`) with a modern equivalent inside HRMS2/mas_hrms:
same business rules (proforma → approval → numbered bill, GST calc, provision
draw-down, PO consumption, credit notes), same PDF output, modern UI/UX,
continuing the legacy numbering sequence rather than restarting it. db_bill
will be retired once HRMS2 is live; until then it is a read source only, never
written to by the new system.

This is scoped as ERP-extension work under CLAUDE.md Phase 9 ("Controlled ERP
extensions: expenses, procurement, vendors, contracts, client billing and
finance integration"), but is **built as a separate module from the existing
`erp.service.ts` / `billing_invoice`** — see §3.

## 2. Source system audit (what actually exists today)

Verified live against `db_bill` (192.168.10.22 LAN / 14.97.30.236 public,
MySQL 5.5.44) and `mas_hrms` (192.168.10.6 LAN) on 2026-08-18.

### 2.1 Legacy engine: `InitialInvoicesController.php`

CakePHP controller, 3704 lines, in the DialDesk/MAS billing app
(`Downloads\Controller\Controller\`). Confirmed **actively used** — `tbl_invoice`
had 11,031 rows, 92 created in the last 30 days, 11 created today (2026-08-18).
Credit notes (`tbl_credit_note`) likewise active — 144 rows, latest created
2026-08-18T08:45.

**Two-stage lifecycle:**
1. **Proforma creation** (`billApproval()`, POST): staff pick a `cost_center`,
   add line items (`Particular`/`inv_particulars`: service, qty, rate, amount)
   and optional deductions, apply GST (18% integrated or 9%+9% intrastate,
   hardcoded), draw down `Provision` balance for selected prior months. Mints
   `proforma_bill_no = 'PI/' + state_code + '/' + n` via
   `SELECT MAX(proforma_bill_no) FROM bill_no_master WHERE id=1` + `LOCK TABLES
   tbl_invoice READ` (wrong table/mode — see bug list). Inserts into
   `tbl_invoice` with `bill_no=''`, `status=0`.
2. **Bill approval / numbering** (`update_bill()` and a near-duplicate PO-aware
   path `genrate_bill()`, both POST): mints the real bill number
   `state_code + '-' + idx + '/' + FYshort` (e.g. `09-274/26-27`), scoped by
   `(state_code, company_name, finance_year)`, idempotency-guarded by
   `BillNoChange != 0`. Copies ~34 columns from `cost_master` onto the invoice
   row (frozen snapshot at approval time, not a live join) — including
   `TallyHead`/`client_tally_name`. `genrate_bill()` additionally consumes
   `po_number.balAmount`.

**Credit notes** (schema-only; PHP controller not in the available dump):
`tbl_credit_note` (39 cols) + `credit_particulars` (15 cols). `credit_no` is
generated as `DD-MM/FY-FY` (e.g. `18-08/26-27`) — **not a real sequence**;
confirmed two credit notes created the same day share an identical `credit_no`
(ids 163 and 164, both `"18-08/26-27"`). `proforma_bill_no` on a credit note
actually stores the *referenced invoice's real bill_no* (e.g. `09-155/26-27`),
a legacy field-name reuse to note, not replicate literally.

**Confirmed bugs in the live legacy system** (decision: fix all, keep the
business rules — see §6):
1. Bill/proforma numbering: `LOCK TABLES tbl_invoice READ` (wrong table, wrong
   mode) — no real concurrency protection, duplicated independently in
   `billApproval()`, `update_bill()`, `genrate_bill()`, and again in
   `DialdeeViewsController.php`/`Dialdee2ViewsController.php`.
2. `billApproval()`: provision-insufficiency rejection is commented out —
   under-provisioned months are silently skipped, not blocked.
3. `billApproval()`: `if($serviceTax=='1'){$total=0;...}` zeroes `total` after
   `igst/cgst/sgst` were already computed off the original amount.
4. Three inconsistent "reject" mechanisms: `update_proforma()` → soft
   `status=1`; `update_bill()` → **hard DELETE**; `reject_invoice()` → soft
   `status=1` again but with a broken refund (below); `delete_invoice()` → a
   fourth, fully dead/commented-out endpoint.
5. `update_invoice()`: `Provision.provision_balance` update references
   undefined `$mnt` (loop var is actually `$Nmonth`) — silently writes garbage
   into the balance on every edit that reaches this path.
6. `update_invoice()`: refund of old provision balance on cost-centre/month/FY
   change is commented out — balance permanently lost on that edit path.
7. `reject_invoice()`: `'provision_balance' => 'provision_balance' + $total`
   is evaluated by PHP, not MySQL — it **overwrites** the balance with just
   the total instead of adding it back.
8. `reject_invoice()` fires on a bare GET request — no CSRF protection.
9. `send_payment_data()`: hardcoded production PhonePe merchant ID + salt key
   in source.
10. `paymentResponse()`: dead code — `print_r($_POST); die;` on line 1 makes
    ~270 lines of payment-callback handling unreachable.
11. `beforeFilter()`: every conditional `Auth->allow()` gate wrapped in
    permanently-true `if(1){...}` — access control is effectively disabled
    for nearly every action in this controller.
12. `credit_no` collision (see credit notes above) — not a per-note-unique
    identifier.
13. Numerous raw-SQL string-concatenation query sites (SQL-injection-shaped,
    even where blast radius is limited to lookup tables).

**No live Tally integration exists.** Grepped the entire controller directory
for `tally`/`voucher`/`tbl_voucher_entries`/`tbl_tally_row_invoice_data` — zero
hits beyond two metadata columns (`cost_TallyHead`, `cost_client_tally_name`)
copied from `cost_master` onto the invoice at approval time. `tbl_voucher_entries`
(1,232 rows, live, last updated 2026-08-12) is a maintained ledger-name lookup
table only. `tbl_tally_row_invoice_data` (35 rows) was a single one-time
export/import batch from 2022-04-02, never repeated — dead, not a sync
mechanism. Conclusion: replicate the two identity fields; there is no
automation to port because none exists.

### 2.2 Target system audit: `mas_hrms`

- **`cost_centre_master`** (852 rows, 80 cols) — already the live, actively-used
  (90+ backend files) modern replacement for legacy `cost_master`, with its
  own richer L1/L2 approval workflow. **New invoicing hangs off this table**,
  not a new client master. Legacy's Tally identity fields already carried
  over (`tally_head`, `billing_client_name`).
- **`erp.service.ts` / `erp.routes.ts` / `billing_invoice`** — a *different*,
  already-built and already-mounted (`app.ts:108`) invoicing path: rate-card
  auto-generation (`billing_unit.rate × billable_units` over a period),
  single-stage, `INV-<YYYYMM>-<processCode>-<seq>` numbering, keyed to
  `process_id` not `cost_centre_master`. **Empty (0 rows) — unused.** Decision
  (§3): leave entirely untouched, build the legacy replica as a separate
  module.
- **`billing_invoice_snapshot`, `billing_invoice_particular_snapshot`,
  `billing_provision_snapshot`, `billing_provision_deduction_snapshot`,
  `billing_credit_note_snapshot`, `billing_credit_note_line_snapshot`,
  `bill_client_snapshot`** — a prior one-time migration effort's read-only
  mirror of db_bill. **All rows share one `synced_at` timestamp
  (2026-08-06T05:2x) — a single batch run, not a running job, now 12 days
  stale** (db_bill has 11,031 invoices live vs 10,987 snapshotted). Decision
  (§3, Approach A): left untouched as historical reference; the new live
  schema is seeded from a **fresh** db_bill pull at cutover, not from this
  stale snapshot.

## 3. Architecture decision

**Approach A (selected): dedicated new schema, snapshot tables stay pure
history.** New tables become the live system of record, seeded once from a
fresh db_bill pull. `billing_invoice`/`erp.service.ts` and the
`billing_*_snapshot` family are left completely alone — no schema changes, no
new columns, no repurposing. Two invoicing paths exist side by side
(rate-card auto-generation via the existing ERP module, and this manual
proforma/approval replica); retiring or merging them is an explicit future
decision, not part of this build.

Rejected: Approach B (extend `billing_invoice` to carry both models) — would
require modifying already-live, already-mounted routes/service, which
CLAUDE.md requires explicit approval to broadly change, and the snapshot
tables' shape (denormalized `bill_source_id`/`synced_at` mirror columns) is
built for read-mirroring, not for being written to directly by a new UI.

## 4. Data model (new tables, `mas_hrms`)

All new tables live in a new `client-billing` module namespace. FKs point at
`cost_centre_master.id`, not denormalized string joins (legacy's `cost_center`
string-match pattern is not replicated).

- **`client_invoice`** — replaces `tbl_invoice`. Explicit
  `invoice_status` enum (`proforma`, `approved`, `rejected`) instead of
  legacy's overloaded `status`/`BillNoChange` dual-purpose fields. Separate
  nullable `proforma_no`, `bill_no` columns minted at their respective stages.
- **`client_invoice_line`** — replaces `inv_particulars` + `inv_deduct_particulars`,
  unified via `line_type` (`charge` | `deduction`).
- **`client_invoice_number_sequence`** — replaces `bill_no_master`'s broken
  locking. One row per `(company, state_code, finance_year)`, minted inside a
  real DB transaction (`SELECT ... FOR UPDATE` or unique-constraint +
  retry-on-conflict), never `LOCK TABLES ... READ`. **Seeded at cutover from
  `MAX(BillNoChange)`/`MAX(proforma_bill_no)` per scope, read live from
  db_bill immediately before go-live** — continues the legacy sequence per
  the standing ruling (numbering must not restart at 0).
- **`client_provision`, `client_provision_deduction`** — replace
  `provision_master`/`provision_master_month_deductions`. Balance mutations
  done as atomic SQL (`balance = balance - ?`), not legacy's broken
  read-modify-write-in-app-code pattern (bug #5 fixed by construction).
- **`client_po_number`, `client_po_particular`** — replace `po_number`/
  `po_number_particulars`.
- **`client_credit_note`, `client_credit_note_line`** — replace
  `tbl_credit_note`/`credit_particulars`, with `client_invoice_number_sequence`
  (or an equivalent dedicated credit-note sequence) generating a real unique
  `credit_no` — fixing the `DD-MM/FY` collision bug, not replicating it.
- **`client_invoice_audit_log`** — unifies `EditAmount`'s old/new-amount trail
  into one append-only audit covering every state transition (creation,
  edit, approval, rejection with reason) — replacing legacy's four
  inconsistent reject mechanisms with one soft-delete + audit-reason flow.

## 5. Lifecycle (business rules preserved, mechanics fixed)

```
proforma created --(approve)--> approved (bill number minted) --(edit)--> approved
       |                                |
       +---------(reject)---------------+---(reject)---> rejected (soft, audited, refunds provision correctly)
```

Tax calculation (18% integrated / 9%+9% intrastate GST), the Mon-YY
financial-year math (currently copy-pasted ~8 times across the legacy
controller), provision draw-down validation, and PO-balance consumption are
all preserved as designed — computed via one shared helper function instead
of duplicated per-endpoint, so a future fix only has to happen once.

## 6. Bug disposition

Per user decision: **fix all confirmed legacy bugs, keep every intended
business rule.** Concretely:
- Numbering: real transactional locking (§4) replaces the broken
  `LOCK TABLES READ` pattern everywhere it appeared.
- Provision balance math: atomic SQL updates, no undefined-variable
  corruption, refund-on-reject actually adds back instead of overwriting.
- Reject: one mechanism (soft status + required reason, audited), not four.
- Auth: `requireAuth`/`requireRole` enforced from the first commit — no
  `if(1)` bypass equivalent.
- State-changing actions: POST/PATCH only, with the app's existing CSRF/auth
  posture — no GET-triggered mutations.
- No hardcoded secrets (PhonePe key was legacy-only and out of scope here
  regardless — this module doesn't touch payment gateways).
- `credit_no` collision: fixed via a real sequence (§4).

The resulting invoice/credit-note **numbers and amounts** should match what
legacy would have produced for the same inputs; only the broken internals
(locking, refund math, reject semantics, auth) are corrected.

## 7. PDF output

Server-rendered from the same underlying data (client GST/HSN/address fields
already present on `cost_centre_master`), matching legacy's proforma and bill
layouts. Before implementation, pull an actual rendered legacy PDF (via
legacy `view_pdf()`, e.g. invoice id 11724 from 2026-08-18) as the concrete
visual reference, so "same PDF preview" is verified against a real sample
rather than assumed from column names.

## 8. Backend module

New `client-billing` module (`client-billing.routes.ts` / `.service.ts`)
alongside — not inside — the existing untouched `erp` module.
`requireAuth`/`requireRole` gating on every route from day one, mirroring the
pattern already used in `erp.routes.ts`.

## 9. Frontend

New React screens under the ui-ux-pro-max design system (design-system search
run before building any screen, per CLAUDE.md's mandatory UI workflow):
proforma creation, approval queue, invoice list/detail, PDF preview,
credit-note flow. Built fresh against the new API, not a skin over the
legacy CakePHP forms.

## 10. Migration & cutover

One-time fresh pull from live db_bill (not the stale 2026-08-06 snapshot) for
full historical data into the new tables. Sequence counters seeded from live
`MAX()` per `(company, state_code, finance_year)` scope at cutover time.
`billing_invoice_snapshot`-family tables are left untouched as a historical
reference — never converted to live, never written to by the new module.

## 11. Explicitly out of scope for this spec

- Retiring/merging the existing `erp.service.ts`/`billing_invoice` rate-card
  path — separate future decision.
- Tally export automation — none exists in the legacy system to replicate;
  only the two identity fields (`tally_head`, `client_tally_name`) carry
  over, already present on `cost_centre_master`.
- Payment-gateway integration (`send_payment_data`/`paymentResponse`) — dead/
  broken in legacy and unrelated to the core invoicing lifecycle.
- Credit-note PHP business logic beyond what's inferable from schema —
  the controller for `tbl_credit_note` was not present in the available
  source dump; its numbering/approval rules are reconstructed from data
  (§2.1) and the same lifecycle pattern as invoices, to be confirmed against
  any additional legacy source if it surfaces during implementation.

## 12. Open items to confirm during implementation planning

- Exact credit-note `status` value semantics (sample data only showed
  `status=1`/`credit_approve=1` rows; a `status=0`/pending sample was not
  captured during design).
- Whether `client_contract_master`/`billing_unit`/`process_billing_rate`/
  `cost_centre_seat_rate` (existing, currently-empty modern rate-card tables)
  should be wired into the new module later for seat-rate clients, versus
  staying scoped to the existing `erp` rate-card path only.
