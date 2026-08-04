# db_bill money path — what fills which field, and how each P&L figure is derived

**Status:** verified read-only against live `db_bill` and `mas_hrms`, 2026-08-04.
**Why this exists:** `db_bill` is the live finance system; `mas_hrms` mirrors it. Every P&L figure
traces back to one of three chains below, and several of the source columns mean something other
than their name suggests. Getting one wrong does not raise an error — it produces a plausible
number, which is how an 82% operating margin and a doubled budget both reached production.

---

## The three chains

| Stage | db_bill header → line | rows | mirrors into (mas_hrms) |
|---|---|---|---|
| **Budget** | `expense_master` → `expense_particular` | 18,433 / 121,635 | `finance_budget_snapshot` / `finance_budget_line_snapshot` |
| **Spend (GRN)** | `expense_entry_master` → `expense_entry_particular` | 85,464 / 127,491 | `grn_entry_snapshot` / `grn_entry_line_snapshot` |
| **Revenue** | `tbl_invoice` → `inv_particulars` | 10,957 / 21,055 | `billing_invoice_snapshot` / `billing_invoice_particular_snapshot` |
| Heads | `tbl_bgt_expenseheadingmaster` (52) + `tbl_bgt_expensesubheadingmaster` (184) | 236 | `finance_expense_head_snapshot` |
| Cost centres | `cost_master` | 926 | `cost_centre_master` |

---

## 1. Budget — `expense_master` → `expense_particular`

`expense_master` is one budgeted amount for one **(BranchId, FinanceYear, FinanceMonth, HeadId,
SubHeadId)**, carrying a five-stage approval (`Approve1..5` + `ApproveDate1..5`).

`expense_particular` is **not a list of line items** — it is a two-level attribution *tree* for
that one amount:

```
expense_master.Id 31125   Amount 150000   NOIDA-2  Jul  Head 1 / SubHead 1
   └─ ExpenseType 'CostCenter'  Id 168190  ExpenseTypeName 'BSS/BO/NOIDA-2/576'  Amount 150000  Parent NULL
        └─ ExpenseType 'Particular'  Id 168191  ExpenseTypeName 'mannual'  Amount 150000  Parent 168190
```

The child links to its parent through `Parent` (→ the CostCenter row's `Id`) and
`ExpenseTypeParent` (→ the cost centre's `ExpenseTypeId`).

### ⚠ The "stored twice" trap, correctly explained

Both levels carry the **same** `Amount`, because the sole child is 100% of its parent. They are
not duplicate rows — they are parent and child. Summing the table without filtering counts the
money twice.

Reconciled for FY2026-27 Jul:

| | |
|---|---|
| `expense_master.Amount` | **₹81.52 L** |
| `expense_particular` where `ExpenseType='CostCenter'` | **₹81.52 L** ✅ |
| `expense_particular` where `ExpenseType='Particular'` | ₹81.52 L (the same money, one level down) |
| both together | ₹163.04 L ❌ |

**Rule: filter `ExpenseType = 'CostCenter'`.** That level carries the real cost-centre code in
`ExpenseTypeName`, which is what attributes budget below branch. `'Particular'` holds free text
(commonly the literal string `mannual`) and is useless for attribution.

`expense_master.Amount` is an equally valid total and reconciles exactly — use it when you need
only a branch/head total and no cost-centre split.

---

## 2. Spend — `expense_entry_master` → `expense_entry_particular`

`expense_entry_master` is the GRN header: `GrnNo`, `BranchId`, `Vendor`, `HeadId`, `SubHeadId`,
`Amount`, `ExpenseDate`, `CGST`/`SGST`/`IGST`, plus the approval and dispatch columns.

`expense_entry_particular` is the real line: `Particular`, **`CostCenterId`**, `Amount`, `Rate`,
`Tax`, `Total`.

- **`CostCenterId` is the only place spend is attributed below branch**, and it is 100% populated.
- **`Total` is the figure to sum.** `Rate` and `Tax` are `NULL` on ordinary rows and `Total` equals
  `Amount` there — so `Total` is safe in both shapes, and deriving `Rate × Amount + Tax` is not.

### ⚠ `Reject` is not a rejection flag

`expense_entry_master.Reject` is `1` on **85,255 of 85,463** rows — it is the default state, not a
decision. Only 1,894 carry a `RejectDate`, and 80,074 of the "rejected" rows carry an
`ApprovalDate`.

**Rule: `is_rejected := RejectDate IS NOT NULL`.** Reading the flag marks 99.8% of spend rejected.
The live mirror found **11** genuine rejections in 1,434 in-scope rows.

---

## 3. Revenue — `tbl_invoice` → `inv_particulars`

`tbl_invoice` is the invoice header: `invoiceType`, `month` (`'Jun-26'`), `total`, `tax`, `igst`,
`sgst`, `cgst`, `grnd`, `status`, `finance_monthYear`.

`inv_particulars` is the billed line: `cost_center_id`, `cost_center`, `service`, `particulars`,
`rate`, `qty`, `amount`, `month_for`.

- **`amount = rate × qty`**, verified — and `qty` is **fractional**, because the dominant model is
  a monthly rate per FTE against part-month FTE counts, not a seat count. `qty` of 0 occurs and is
  legitimate (a line raised at zero).
- **`inv_particulars` is the only place the cost-centre-wise rate exists.** Nothing else carries it.

### ⚠ Use `total`, not `grand`

`tax_amt` is `0` on every mirrored row and is **faithful** — `tax` is 0 at source and GST lives in
`igst`/`sgst`/`cgst`, with `total + igst + sgst + cgst = grnd` exactly. So `grnd` includes GST and
`total` is the net figure. Comparing `grnd` against a net cost overstates revenue by the tax.

Also: `invoice_type = 'Non Revenue'` rows exist (3 of 339 FY2026-27) and must be excluded.

---

## 4. Heads and sub-heads — the id collision

Two masters, **two independent id sequences that overlap**:

| | rows |
|---|---|
| `tbl_bgt_expenseheadingmaster` | 52 |
| `tbl_bgt_expensesubheadingmaster` | 184 |

Both mirror into one table, `finance_expense_head_snapshot`, distinguished only by `head_type`
(`'head'` / `'subhead'`). `bill_source_id` is **not unique**: `'000001'` is both the head
*Communication & Connectivity* and the sub-head *Performance Incentives*. 25 ids collide.

**Rule: every join must be qualified by `head_type`.** Unqualified, rows fan out ~3× and heads
pair with unrelated sub-heads — live output showed *"Tea, Coffee & Refreshment / Office Rent"* at
exactly the same ₹21.61 L as *"Office Rent / Office Rent"*.

A second form of the same trap: ids are stored as strings with leading zeros, and
`CAST(HeadingId AS UNSIGNED)` matches both `'1'` (Security Service Charges) and `'000001'`
(Communication & Connectivity) — appearing to resolve 100% while doubling every row.
**Join on the exact string.**

---

## 5. Month dialects — three of them

| source | format |
|---|---|
| `tbl_invoice.month` | `'Jun-26'` |
| `inv_particulars.month_for` | `'Jun'` |
| `expense_master` | `FinanceYear` `'2026-27'` + `FinanceMonth` `'Jun'` |

Normalise to one `period_code` (`YYYY-MM`). **Jan–Mar of FY2026-27 are calendar 2027.**

---

## 6. Amounts are not integers

`expense_entry_master.Amount` has decimals on ~6,500 rows (₹2.15 up to ₹33,17,122.54), and
`inv_particulars.qty` is fractional. `safeInt()` is correct **only** for `tbl_invoice`, which
really does hold whole rupees. Use `safeDec` everywhere else.

---

## 7. Which of the 92 finance tables are live

Live: `expense_master`, `expense_particular`, `expense_entry_master`, `expense_entry_particular`,
`tbl_invoice`, `inv_particulars`, `cost_master`, `tbl_bgt_expenseheadingmaster`,
`tbl_bgt_expensesubheadingmaster`, `bill_pay_particulars`, `billing_consume_daily`,
`billing_ledger`, `billing_opening_balance`.

Not live — do not read: anything suffixed `_old`, `_bkp`, `_delete`, `_reject`, `_his`,
`_history`, `_approve`, `_before_20_oct`, `_04_nov`; anything prefixed `tmp_`/`tm_`; and the
numbered variants `expense_master2`, `expense_particular2`/`3`, `cost_master2`/`3`/`_1`,
`expense_entry_master2`, `expense_entry_particular2`. Several are large enough to look
authoritative — `expense_entry_master_04_nov` holds 63,398 rows — which is exactly the risk.

---

## How this reaches the P&L

| P&L line | derived from |
|---|---|
| Recognised Revenue (closed month) | `billing_invoice_particular_snapshot.amount`, summed per period, cost centre → branch/process |
| Recognised Revenue (open month) | `finance_cost_centre_monthly_driver`: `planned_headcount × revenue_rate_per_head` |
| Total Indirect Cost | `grn_entry_line_snapshot.total` where `is_rejected = 0`, by cost centre |
| Agent Salary / DSC / BMC | `pnl_running_salary_snapshot`, bucketed by `resolveBucket()` — **native to mas_hrms, not db_bill** |
| Branch budget (Prev/Var) | `finance_budget_line_snapshot` where `expense_type = 'CostCenter'`, head/sub-head resolved by `head_type` |

---

## Open mapping defects (found here, fixed separately)

1. **People cost understates payroll by about half.** `pnl_running_salary_snapshot` holds
   ₹141.23 L for June against ₹227.88 L actually paid (`salary_prep_line`, 1,530 people); April is
   ₹112.11 L against ₹221.65 L. The snapshot only covers employees it can recompute. Using actual
   payroll puts the operating margin at 16.2% (June) and 9.7% (April) — the expected band — instead
   of ~43%. **Not a db_bill issue; a mas_hrms one.**
2. **~₹45 L of April invoiced revenue lands on cost centres that resolve to no branch column**, so
   it appears in no P&L column (₹355.37 L total invoiced vs ₹310.26 L reaching the statement).
3. **Process-level revenue is entirely unconfigured** — `process_revenue_rule`,
   `process_delivery_actual`, `process_revenue_component` and `process_monthly_plan` hold **zero**
   rows, so `bpoPnlService` reports ₹0 for every money column in every month.
4. **Seat rates cover 7 of ~95 trading cost centres**, and all 18 are effective 2026-08-01, so
   earned seat revenue is legitimately ₹0 for April–July.
