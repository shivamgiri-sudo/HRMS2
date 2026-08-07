# Salary voucher: what the extra MAS columns are, and why IDC cannot be generated

Investigated 2026-08-08 against the June-2026 run `939efccb-e7ea-4194-b059-db9b9c200a7d`
(1,429 employees) and the two supplied reference files.

Two questions were open and blocking the Payroll → Tally salary voucher generator. Both are now
answered from data, not assumption.

---

## 1. The extra MAS columns are a two-way split of every ledger line

`MAS SALARY VCH JUNE - 2026.xls` has two unnamed columns between `Amount` and `DebitCredit`.
`IDC SALARY VCH JUNE - 2026.xls` has none — it goes straight from `Amount` to `DebitCredit`.

The relationship is exact on every MAS row:

```
Amount = col4 + col5

2,068,445 =  99,598 + 1,968,847     (Ahmedabad, Gross Salary)
   59,034 =  16,800 +    42,234     (Head Office, Employer's Contribution to Epf)
   78,860 =  16,000 +    62,860     (Head Office, TDS SALARY 2026-27)
```

So they are not additional figures. They are the same figure, cut in two.

### col4 is C-suite remuneration

At each branch a **single employee** reproduces all four of col4's headline figures
simultaneously — gross, Salary Payable, employer PF and TDS:

| Branch | gross | payable | PF employer | TDS | Employee |
|---|---:|---:|---:|---:|---|
| HEAD OFFICE | 166,262 | 133,462 | 16,800 | 16,000 | `MAS00001` DEEPAK KASHYAP — Chief Executive Officer |
| AHMEDABAD-JALDARSHAN | 99,598 | 84,958 | 8,640 | 5,800 | `MAS02477` BHAVANA BOBBY HARJANI — Chief Operations Officer |
| NOIDA | 0 | 0 | 0 | 0 | — no C-suite employee |
| NOIDA-2 | 0 | 0 | 0 | 0 | — no C-suite employee |

The two zero branches are what make this conclusive rather than coincidental. If col4 were
"the highest earner at each branch", NOIDA and NOIDA-2 would carry a figure; they carry zero,
and neither has anyone with a `CHIEF%` designation.

**The rule is `designation_name LIKE 'CHIEF%'`.** Company-wide it selects exactly these two
real employees, plus two zero-value `EMP-` seed rows that contribute nothing. This is ordinary
Tally practice: key managerial remuneration posts to a separate ledger from staff salary.

Earlier hypotheses, both disproven and recorded so they are not retried:

- **Trainee split** — Head Office has 16 ONROLL and 0 trainees in this run, yet col4 is 166,262.
- **Onroll vs offroll** — both named employees are `ONROLL`.

### Where the rule belongs

`finance_payroll_entity_rule` (migration 1098) ships EMPTY on purpose, and this is what it is
for. The rule should be **configuration, not code**: a designation-based predicate Finance can
change when the C-suite changes, rather than two employee codes compiled into a service.

---

## 2. IDC payroll is not in this database

`employee_code` carries the legal entity — `MAS…` vs `IDC…`. That part of the question is
answered. But:

- **mas_hrms holds 0 IDC-coded employees**, out of 58,627 employee rows.
- `NOIDA-DIALDESK` — one of the two branches on the IDC voucher — exists as an active branch
  with 149 employees and **0 active** ones.
- The June run contains only `MAS…` and un-prefixed codes. No IDC line exists to total.

The supplied salary sheet has 134 IDC-coded people with no counterpart here.

**Consequence:** the MAS voucher is generatable from HRMS2 today; the IDC voucher is not. That
is a data-availability fact, not an engineering gap — no amount of code produces a voucher for a
population the database does not contain. Generating IDC needs its payroll brought into
mas_hrms, or the voucher continues to come from the legacy system.

---

## 3. Two things to settle before trusting a generated voucher

**Gross does not tie, while net does.** At HEAD OFFICE, `net_salary` (1,036,519 — the Salary
Payable line), `pf_employer` (59,034) and TDS (78,860) match the voucher **exactly**; gross is
off by 1,167. At AHMEDABAD-JALDARSHAN every col4 figure matches exactly, but the branch total
gross is 2,144,302 against the voucher's 2,068,445 — a 75,857 gap, ~3.5%.

The credit side reconciles and the debit side does not, which points at a definitional
difference in what "Gross Salary" includes rather than at missing people. Resolve that before
the Gross Salary debit line is generated, because it is the one figure that would post wrong.

**The supplied `SALARY SHEET.xls` cannot be used for amounts.** `Basic`, `Gross`, `Gross1`,
`NetSalary`, `EPF`, `ESIC` and `IncomeTax` are **0 on all 1,566 rows**. Only day counts,
`ProTaxDeduction` (17,000, which does match Ahmedabad's Professional Tax line), `OtherDeduction`
and dates carry values. `salary_prep_line` is the source of truth.

---

## Ledger lines the voucher uses

Debit: `Gross Salary`, `Employer's Contribution to Esic`, `Employer's Contribution to Epf`,
`EPF Admin Charges`.

Credit: `Salary Payable A/C`, `ESIC Payable`, `EPF Payable`,
`Advance Against Salary (<BRANCH>)` — one row per advance, not consolidated —
`STAY HEALTHY STAY HAPPY INSURANCE`, `GROSS SALARY`, `Professional Tax 2026-27`,
`TDS SALARY 2026-27`.

Voucher number is `<BRANCH>/<COMPANY>/<MM>/<YY>/<SERIAL>`, cost centre `<SHORT>/<YYMM>`,
`VchType` `JRNLSAL`. Note the credit-side `GROSS SALARY` is a distinct line from the debit-side
`Gross Salary` and carries small amounts (833 at Ahmedabad, 205,989 at NOIDA-DIALDESK) — it is
not a duplicate of the debit line and must not be merged with it.
