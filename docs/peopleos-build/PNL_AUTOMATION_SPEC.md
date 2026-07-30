# Process P&L — automation spec

Agreed with the product owner on 2026-07-31, and aligned against the real workbook
`Onfido PL_Updated till 29-July-26.xlsx`. Written down because the built model does not match the
P&L the business actually runs, and that gap would otherwise be rediscovered every session.

## Why this exists

The P&L page renders and its maths works, but it had almost nothing to show. Measured against live
data on 2026-07-31:

| Component | 2025-12 | 2026-05 | 2026-06 | 2026-07 | 2026-08 |
|---|---|---|---|---|---|
| `active_headcount` | 713 | 1,094 | 1,179 | 1,194 | 1,194 |
| `recognized_revenue` | 0 | 0 | 0 | 0 | 0 |
| `agent_salary` | 0 | 0 | 0 | 0 | 2,07,01,224 |
| `total_dsc` / `total_bmc` | 0 | 0 | 0 | 0 | 0 |

Only headcount flowed. The blank margin rows are correct, not broken — `pct()` returns null rather
than dividing by zero revenue.

An end-to-end test (NOIDA-2, Aug-2026) proved both chains work: budget `BUD/42/202608/F7087244`
went draft → submitted → branch head → finance head → **active**; a GRN was raised, evidenced,
submitted and approved to `pending_accounts_payment`, consuming **Rs 66,500**. That consumption
never reached the P&L. Spend updates `finance_budget_line.consumed_amount` and stops there.

## The real P&L shape (from the Onfido workbook, Jul-2026 column)

```
Revenue                                    94,20,623
  Billed agents            200.82  x  Seat Rate
  With buffer              240.23  (buffer 1.1962)
  Agent Variable: night shift / performance / overtime / reference /
                  retention bonus / client-paid incentive
Agent Salary + Incentive   46,52,057          49.4%
DSC   # 46    Salary       14,07,527          14.9%
BMC   # 12    Salary        5,33,867           5.7%
DC Total                   65,93,451          70.0%   = Agent + DSC + BMC
Total Indirect Cost (IDC)  16,88,359          17.9%
Total Cost                 82,81,810          87.9%   = DC + IDC
Operating Profit           11,38,813          12.1%   = Revenue - Total Cost
```

Three corrections to what is currently built:

1. **IDC is its own cost block**, not part of BMC. The workbook's IDC sheet is the branch-budget
   expense master: 22 heads / 40 sub-heads against the HRMS master's 21 / 39 — the same list
   (Business Promotion, Communication & Connectivity, Electricity, Contract Fees, Fee &
   Subscription …). This is why **all GRN spend goes to IDC**: a GRN is raised against exactly
   those heads.
2. **DSC and BMC are salary categories split by designation**, not people/non-people cost pairs.
   DSC = delivery support (QUALITY AUDITOR, Asst. Manager, DM-Ops). BMC = management and shared
   services (EXECUTIVE, EXECUTIVE-IT, MANAGER-IT, DY. GENERAL MANAGER). Both sheets are per
   employee with Process Name / Cost Centre / Emp_Code / Designation.
3. **The waterfall is DC Total → Total Cost → Operating Profit**, not contribution → EBITDA → EBIT
   → PBT → PAT. `finance_pnl_component_master` has no IDC component at all and models
   `dsc_people` / `dsc_non_people` / `bmc_people` / `bmc_non_people`, which do not exist in the
   real statement.

## Data sources

| Line | Source | State |
|---|---|---|
| Revenue | `finance_cost_centre_monthly_driver`: `planned_headcount x revenue_rate_per_head` | exists as `calculatedPlannedRevenue`, simply not read by the P&L |
| Agent salary | payroll / `db_bill.salary_data`, agents only | flows for Aug-2026 (Rs 2.07 Cr) |
| DSC salary | same source, support designations | not wired |
| BMC salary | same source, management designations | not wired |
| IDC | approved GRN consumption per head/sub-head | consumed correctly, never forwarded |
| Headcount / seats | `employees`, `cost_centre_master.mandated_seats` | already correct |

**Revenue basis decision: headcount x rate, NOT seats x rate.** Revenue tracks who is actually
deployed rather than contracted capacity. `seat_count` exists (migration 434) but is not the basis.
Note this makes revenue a *planned* figure from the budget, not invoiced actuals;
`db_bill.inv_particulars` is live to Jul-2026 and reachable if invoiced revenue is ever wanted.

**IDC timing: accrual on GRN approval**, not on payment. Cost lands in the month goods/services
were received, which is also the budget month the GRN consumed. Approved 15-Aug, paid 20-Sep = an
August cost.

## Known defects to fix alongside

1. **Coverage ignores `active_status`.** A junk `test / testtest` head held NOIDA-2 coverage at
   97.44% and made every budget unsubmittable. Deactivating the head *and* sub-head did not remove
   it — coverage still reported `total=39`. Retiring any master head will keep blocking submissions
   until `getCoverage` filters on `active_status`.
2. **Attribution.** Cost centre → process is NOT `cost_centre_master.process_id` (NULL on every
   live row). The working derivation is via the employees posted to the cost centre, as used by
   `/api/org/cost-centres` and `listActiveCostCentres()`. Any ingestion must use it or spend and
   revenue land unattributed.
3. **Unsatisfiable allocation drivers** — fixed in `bfae2f1a`; `floor_area` and `device_count`
   silently split by headcount. `SUPPORTED_ALLOCATION_DRIVERS` is now the single source of truth.

## Build order

1. Fix coverage `active_status` filtering — small, and it currently blocks every branch.
2. Restructure `finance_pnl_component_master` to the real shape: add IDC, redefine DSC/BMC as
   salary categories, and replace the EBITDA/PBT/PAT tail with DC Total → Total Cost → Operating
   Profit. Additive migration; keep the old components inactive rather than dropping them.
3. GRN consumption → IDC, accrual at approval. This is the gap the end-to-end test proves, and the
   only one where money already exists and is being dropped.
4. Revenue from monthly drivers → `recognized_revenue`.
5. Salary split by designation into Agent / DSC / BMC. Confirm the designation → category rule
   against the workbook's DSC and BMC sheets before coding it.
6. Reconciliation test: for one process and month, prove IDC equals the sum of approved GRN
   consumption, revenue equals driver-derived revenue, and Operating Profit = Revenue − Total Cost.
