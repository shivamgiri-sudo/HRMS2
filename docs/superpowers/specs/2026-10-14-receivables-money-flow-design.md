# Receivables & Money Flow — Design

Status: approved approach A (user, 2026-10-14). Date: 2026-10-14.

## 1. Goal

One accurate picture of client money inside **Finance → Ledger → Analytics**:
provision (expected) → proforma → bill raised → submitted to client → money received
(gross, TDS, deductions) → credited in bank; plus what we owe vendors, side by side.
Every figure must reconcile to the rows behind it and be stored in exact decimal form.

## 2. Why the current tab cannot be trusted

- Outstanding = `grand_total` of every not-`paid` invoice; partial receipts, TDS and credit
  notes are never subtracted.
- "Invoiced" comes from `client_invoice`, "collected" from the db_bill mirror
  (`client_bill_collection_run_snapshot`); nothing links a rupee received to a bill.
- `payment_voucher.linked_client_invoice_id` exists but is never written; no bank receipt is
  tied to a bill.
- No branch scoping; the API refuses `finance` / branch roles that the page shows the tab to.

## 3. Decisions

| Topic | Decision |
|---|---|
| Source of incoming money | Receipt entry in HRMS against one or more bills (user choice). |
| Bank posting | Each receipt raises one `sales_receipt` payment voucher for the bank credit; the existing raise → approve → release workflow posts it to `bank_account_ledger_entry`. Money is "in bank" only after release. |
| Allocation | A receipt must be fully allocated to bills of the same client; no unallocated/on-account money in this phase. |
| Settled amount per bill | received + TDS + other deduction. Outstanding = grand_total − settled − approved credit notes. A bill can never be over-settled (server check, row lock). |
| Status | `paid` when outstanding ≤ ₹0.50 (paise rounding), `partial` when settled > 0, else `pending`. `overdue` is computed at read time from `due_date`, never stored. |
| Due date | `client_invoice.due_date` = invoice_date + credit days from `cost_centre_master.payment_terms` (first number in the text), default 30; set when the bill number is minted, backfilled for existing bills. |
| Money format | `DECIMAL(14,2)` everywhere; computed in integer paise in code; never floats in SQL sums. Receipt numbers `RCPT/<FY>/<00001>` from the existing atomic sequence table (`kind='receipt'`). |
| Void | A receipt can be voided (reason required) only while its voucher is not released; voiding withdraws the voucher and frees the allocation. After release, a reversal goes through a journal (out of scope). |
| History | One-time import of I-Spark collections (db_bill bill-wise collection rows) as migrated receipts matched to migrated bills by bill number; dry-run first, apply with explicit approval, idempotent by source id. |
| Access | Same roles as Client Billing for writing receipts (admin, finance, finance_head, accounts_head; branch-scoped admin). Analytics readable by the finance roles plus ceo, coo, branch_head, branch_admin, payroll_head; branch_head / branch_admin / admin see only their branch (existing `financeBranchFilter`). |

## 4. Data model (migration, additive)

- `client_receipt`: id, receipt_no (unique), finance_year, receipt_date, client_name,
  company_name, branch_id, amount_received, tds_amount, other_deduction, payment_mode
  (NEFT/RTGS/IMPS/UPI/Cheque/DD/Cash/Other), reference_no, bank_account_id, voucher_id,
  status (`recorded`/`void`), void_reason, remarks, created_by, created_at, is_migrated,
  legacy_source_id (unique, import idempotency).
- `client_receipt_allocation`: id, receipt_id, invoice_id, received_amount, tds_amount,
  deduction_amount; unique (receipt_id, invoice_id).
- `client_invoice.due_date` (DATE NULL).
- `client_invoice_payment_status` gains `other_deduction`; it becomes a derived cache rebuilt
  from allocations inside the same transaction as every receipt write/void.

## 5. Phase 1 — receipts (backend + Client Billing UI)

- Service `client-billing-receipt.service.ts`: `listOutstanding(client/branch)`, `createReceipt`,
  `voidReceipt`, `listReceipts`, `recomputeInvoiceSettlement(conn, invoiceIds)`.
- Routes under `/api/client-billing/receipts` + `/outstanding`.
- UI: Client Billing tab **6 · Receipts**: outstanding bills of a client with ageing, a
  "Record receipt" sheet (date, bank account, mode, reference, amount received, TDS,
  deduction, allocation grid auto-filled oldest-first and editable, live check that totals
  match), receipts list with voucher/bank status and void.
- Download Initial Invoice list shows Received / Outstanding per bill.

## 6. Phase 2 — Ledger Analytics "Money Flow"

New first sub-tab **Money Flow** (existing sub-tabs keep working, rebuilt on the same
outstanding rule):
- KPI strip: Expected (approved provision balance), Billed, Received, Outstanding, Overdue,
  In bank this month, Payables due.
- Funnel by stage with count and amount: unbilled provision → proforma awaiting approval →
  awaiting bill no → billed not submitted → submitted unpaid → part-paid → paid.
- Receivables vs payables ageing (0–30/31–60/61–90/90+), incoming money by week (recorded vs
  banked), top clients by outstanding.
- Every number opens a drawer listing the rows behind it (bill no, client, branch, amounts),
  exportable to CSV.
- Filters: finance year, month, company, branch, client.

## 7. Errors, testing, verification

- All writes in one transaction with `FOR UPDATE` on the bills touched; 400 with a plain
  message on any mismatch (allocations ≠ receipt, over-settlement, closed voucher).
- Unit tests for allocation maths, status rules, due-date parsing, voiding; route tests for
  scoping; a browser run on the local prod-schema rig (record → approve voucher → release →
  analytics shows it; void path; partial payment with TDS).
- Every analytics figure checked against a direct SQL sum in the test.
