# db_bill findings — resolving the blocked finance questions

On 2026-08-10 I got read-only LAN access to the upstream finance databases and used it to answer
the questions that `OPEN-QUESTIONS.md` had parked as "blocked — do not guess". Everything below
was read with `SELECT`/`SHOW` only; nothing was written to any upstream system, per the charter's
read-only rule for `db_bill`.

Credentials are deliberately NOT recorded here — this repo is public.

---

## 1. IDC payroll lives in `db_bill.salary_data` — RESOLVED

The IDC salary voucher was documented as impossible because `mas_hrms` holds zero IDC employees.
That was half the picture. **`db_bill.salary_data` holds them** — it is the monthly salary
computation, the same column set as the supplied `SALARY SHEET.xls`, 154k rows keyed by `SalDate`.

June-2026, IDC-coded, reconciles to the IDC reference voucher **to the rupee**:

| Branch | net = voucher payable | EPFCompany | Stored `VchNo` |
|---|---:|---:|---|
| HEAD OFFICE | 1,112,869 | 46,978 | `IDC/06/26/614` |
| NOIDA-DIALDESK | 1,348,906 | 24,534 | `IDC/06/26/615` |

134 IDC employees that month. The MAS run is in `mas_hrms.salary_prep_line`; the IDC run is only
in `db_bill.salary_data`. `db_bill.masjclrentry` is the IDC/MAS employee *master* (33,144 rows,
one per code, 2,774 IDC) — offered CTC, not monthly pay.

**Two things this settles:**

- The salary voucher serial (`…/614`, `…/615`) is **stored upstream as `salary_data.VchNo`**, so
  it is genuinely external — which is exactly why the generator now *asks* for a starting number
  and labels it provisional when absent, rather than defaulting to 1.
- The IDC voucher is generatable, but only by reading `db_bill.salary_data`, which crosses the DB
  boundary. **This is a design decision, not a coding one** (see §4).

## 2. Req 17 — the Provision → ? workflow — RESOLVED

`provision_master` (7,482 rows) is a **revenue-collection milestone tracker**, not an accrual in
the accounting sense. Each provision carries a chain of activity dates, each with a remark and a
`his_` history copy:

```
Agreement (act_agree_date) → PO (act_po_date) → GRN (act_grn_date)
  → Receipt (act_receipt_date) → Bill Ready (act_bill_ready_date)
  → PTP / promise-to-pay (act_ptp_date) → EPTP / extended PTP (eptp_act_date)
```

`invoiceType1` is `Revenue` (7,352) or `Non Revenue` (7). Supporting tables:
`provision_master_month_deductions` (monthly deductions against a provision),
`move_next_month_provision` (roll unbilled provisions forward), `provision_particulars` (line
items), `provision_master_edit_request` (edits go through request/approval).

A provision becomes a **client invoice** in `tbl_invoice` (11,029 rows), which has its own
approval chain: proforma → PO approve → GRN approve → `bill_no` → `PaymentStatus`, with
`tbl_credit_note` (133) for reversals.

So "Provision → ?" is: **Provision (milestone-tracked) → monthly deductions / roll-forward →
Invoice → (credit note)**. HRMS2's `billing_invoice_particular_snapshot` mirrors the invoice
side read-only; the provision milestone tracker has no HRMS2 equivalent yet.

## 3. Req 15 — the imprest voucher — RESOLVED as already-built

The imprest flow in db_bill is two halves:

- **INFLOW**: `imprest_allotment_master` (2,738) — branch, date, payment mode, amount, ref,
  remarks. This is what HRMS2's `imprest_allocation` mirrors.
- **OUTFLOW**: imprest *expense* vouchers live in the `expense_entry_master` / `expense_particular`
  family (the same GRN-numbered expense system, `Mas/MM/YY/NNN`), filtered to the imprest source.

The `Imprest_Details` report the user supplied — and which is already built and shipped — is
exactly the ledger view over these two: INFLOW from allotments, OUTFLOW from imprest expense
vouchers, running Balance. The "imprest voucher report" (Req 15) is the per-voucher document over
the OUTFLOW side; its columns are the GRN expense fields (Head, Sub-head, amount, mode, remarks),
which the Details report already carries per row.

## 4. The one decision left for the business

**Generating the IDC salary voucher requires HRMS2 to read `db_bill.salary_data`.** The charter
says `db_bill` is a read-only upstream source and connectors read *approved datapoints into*
`mas_hrms` — no live cross-database reads in a request path, no writeback.

So the choice is:

- **Sync** IDC `salary_data` rows for the run into `mas_hrms` (a connector, matching the charter),
  then the existing generator produces the IDC voucher with no further change — a company with no
  cohort rule already emits the single-column shape the IDC file uses; **or**
- **Live-read** `db_bill` from the voucher endpoint (faster to build, against the boundary rule).

The generator itself needs nothing new either way. This is a data-movement decision, and it is
the user's to make.
