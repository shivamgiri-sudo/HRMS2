# Open questions — waiting on the business or on the legacy system

A running register. Each entry says what is blocked, what specifically would unblock it, and
what has already been built around it so nothing is idle while it waits.

**Most of this is expected to answer itself when the legacy PHP HRMS codebase arrives.** Entries
marked *(legacy)* are ones where reading that code should settle it without anyone having to
write a spec.

Last updated 2026-08-08.

---

## 1. Req 15 — Imprest Voucher report format *(legacy)*

**Blocked on:** the reference layout. The user will supply it.

**Why nothing was invented:** the format rule is explicit — a report's columns are a contract,
and guessing one produces a file that looks right and reconciles wrong.

**Already built around it:** the imprest voucher *data* is complete — vouchers are
`grn_type='imprest'` GRNs with the full approval chain, ledger postings and return routing. Only
the printed layout is missing. The `Imprest_Details` report (shipped) is the ledger view; the
voucher report is the per-voucher document, and they are different things.

**What the legacy code would answer:** the exact column list, the page header, and whether a
voucher prints one row per GRN or one per allocation line.

---

## 2. Req 17 — Client invoice / provision *(legacy)*

**Blocked on:** what the second stage of `Provision → ?` actually is.

**Why nothing was invented:** the workflow is genuinely ambiguous, and HRMS2's only billing data
is a read-only mirror of `db_bill`. Building a write path against a mirror would create a second
source of truth for money.

**What the legacy code would answer:** the states a client invoice moves through, who approves
each, and whether "provision" is an accrual, a draft invoice, or a credit note precursor.

---

## 3. The IDC salary voucher — blocked on DATA, not code

**Blocked on:** the IDC payroll population existing in `mas_hrms` at all.

**Measured 2026-08-08:**

| | |
|---|---|
| IDC-coded employees in `mas_hrms` | **0** of 58,627 |
| `NOIDA-DIALDESK` (an IDC voucher branch) | 149 employees, **0 active** |
| IDC-coded people in the supplied salary sheet | 134, with no counterpart here |

**The generator already handles IDC correctly.** A company with no cohort rule emits a
single-column voucher — exactly what the IDC reference file looks like — and migration 1103
seeds the IDC entity rule ahead of the data. It has nothing to total, not nothing to do.

**What the legacy code would answer:** where IDC payroll is actually run, and whether it should
be migrated into `mas_hrms` or keep coming from the legacy system. This is the single highest-
value question in this list.

---

## 4. The Gross Salary definition gap — flagged, not guessed

**Not blocking:** the voucher generates correctly because `Gross Salary` is the balancing plug,
so the journal always balances.

**The open question:** payroll's own gross and the voucher's derived gross differ — by 1,167 at
HEAD OFFICE, and the branch totals diverge more at Ahmedabad and NOIDA where the HRMS2 run holds
more employees than the legacy voucher's population. Every delta is positive and uniform, which
points at population vintage rather than arithmetic.

**Worth confirming with Finance:** whether the legacy voucher's population was frozen at a
different moment than the HRMS2 run, or whether some employees are deliberately excluded.

---

## 5. Data-quality issues found while building — reported, not silently corrected

None of these were touched: correcting master data is a business decision, and several would
change reported figures.

| Issue | Impact | Where |
|---|---|---|
| `HEAD OFFICE` and `Head Office` both exist | Two branch rows for one branch | `branch_master` |
| `AHEMDABAD HOUSE` (misspelt) | Separate branch from Ahmedabad | `branch_master` |
| `ONROLL` / `OnRoll` case variants | Any exact-match rule silently misses rows | `employees.emp_type` |
| Many branches with `gross = 0` but `professional_tax > 0` | Deductions on unpaid employees | `salary_prep_line` |
| `DueDate = 1899-11-29` on live rows | An Excel zero-date that survived import | legacy finance rows |
| `MobileDedcution` (misspelt column) | Anything joining by name must repeat the typo | legacy schema |
| `EMP-ADM-001` designated Chief Executive Officer | Seed row that matches the C-suite rule; contributes 0 | `employees` |
| `cost_centre_master.client_id` empty on all 927 rows | No client→cost-centre derivation is possible | `cost_centre_master` |
| 110 of 131 processes have no cost centre mapped | The Cost Centre column reads "not mapped" | `cost_centre_master.process_id` |

---

## 6. Deploy-time facts, not questions

**Migrations 1099 and 1102–1104 are on `main` but have NOT been run against production.** This
codebase runs migrations at boot, so the next `pm2` restart applies them. All are additive.
Nothing was run against production, per the charter.

**All five were executed against a scratch MySQL seeded with production's REAL DDL**, on
2026-08-08 — `SHOW CREATE TABLE` for every parent, plus `finance_company`'s actual rows, captured
read-only. Nothing was written to production.

| | |
|---|---|
| Migrations run | 1098, 1099, 1102, 1103, 1104 in manifest order |
| Passes | **3**, all clean — a re-run must be a no-op, because `MIGRATION_STOP_ON_FAILURE` blocks every later migration |
| Conditional FKs | all **3** attached (`grn_period_allocation`, `vendor_company_applicability`, `vendor_branch_applicability`) with `ON DELETE CASCADE` |
| Seeds after 3 passes | `finance_company` IDC/MAS/**PIK** · entity rules IDC + MAS · cohort MAS/c_suite · ledger map 24 · voucher grants 3 |
| Page catalog | `/finance/salary-voucher`, matching the route exactly |

The FK result is the one that mattered: those constraints are guarded on the collations matching,
and production's `grn_cost_allocation.id`, `vendor_master.id` and `grn_request.id` are all
`utf8mb4_unicode_ci`, so they attach rather than being skipped.

Seeds did not double across passes — `finance_company` started as IDC + MAS (from 1090, already
applied in production) and finished as IDC + MAS + PIK, which is exactly what 1102 should add.

---

## 7. Who can actually reach the finance screens

Counted from `user_roles` on 2026-08-08. Relevant because several new screens gate on roles held
by very few people.

| Role | Users | Active |
|---|---:|---:|
| `payroll_hr` | 6 | 6 |
| `payroll` | 6 | 3 |
| `super_admin` | 5 | 3 |
| `finance` | 3 | 2 |
| `payroll_head` | 2 | 1 |
| `accounts_head` | 1 | 1 |
| `finance_head` | 1 | 1 |

**`finance_head` and `accounts_head` have one active user each.** A large amount of the finance
module gates on them — imprest master maintenance, GRN finance approval, vendor payment dispatch
— so a single absence stops those flows. That is an operational decision for you, not a code
defect, but it is worth knowing before UAT.

The Salary Voucher page grants `super_admin`, `finance_head` and `payroll_hr`, which reaches 10
active users. `payroll` (3 active) and `payroll_head` (1 active) are deliberately NOT granted:
widening access to a screen that renders a whole branch's payroll is your call, not mine.

---

## 8. Fixed since this register was written — the "built but unreachable" sweep

Nine defects of one shape: every part present, tested and green, with nothing invoking it. A
unit test proves a service WORKS; it never proves anything CALLS it. Recorded here because the
pattern will recur, and because several were features previously reported as delivered.

| What | What silently did not happen |
|---|---|
| Req 12 monthly GRN numbering | `grn_number_format` was read by nothing — flipping the flag did nothing at all |
| Vendor applicability | A vendor restricted to one company or branch still appeared for everyone |
| Imprest voucher debit | A float could only ever go UP; the Details report would show no outflows |
| `assertSufficientBalance` | A float could go negative in silence |
| Req 8 Manager master | Read paths only — nobody could be appointed, so the whole imprest chain was inert |
| Approval history | Five writers, no reader wired: a returned voucher's reason could never be read back |
| `imprest_ledger_entry_id` | Computed and discarded, so a voucher could not be traced to its posting |
| Req 9 resubmit | Return had a UI, resubmit did not — a returned GRN was stuck forever |
| Req 4 billing status | Displayed and filterable, and the setter had no caller |

Two guards now exist so this cannot reopen quietly: a contract test asserting the CALL SITE of
each finance service (proven non-vacuous by deleting one), and the route-contract test that
already scans frontend calls against the registered route table.

Two endpoints remain deliberately UI-less and are not defects: `/vendors/:id/ship-to` is a
document helper with no document yet, and `/imprest/ledger` is the raw feed the Details report
supersedes.

