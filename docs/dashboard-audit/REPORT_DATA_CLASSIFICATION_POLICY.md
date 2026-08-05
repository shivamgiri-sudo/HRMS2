# Report Data Classification Policy

**Status:** interim — ratifies the heuristic already applied to all reports in `REPORT_CATALOG` (`backend/src/modules/reporting/report-catalog.ts`); needs compliance/security sign-off to become authoritative. Until signed off, this is the working rule, not a confirmed policy — see `OPEN_POLICY_QUESTIONS_2026-08-05.md` item 3.

## Why this exists

Every report in the catalog carries `sensitivityLevel`, `containsPII`, and `containsFinancialData`, which gate `viewRoles`/`exportRoles`. All 50 current entries were classified by inspecting each report's columns against the rules below — no prior written policy existed to check them against (checked `docs/`, including `docs/dpdp/`; none defines this scheme). This document is that missing policy, written from the classification already in use rather than invented fresh, so today's ~50 entries don't need to be reclassified — only confirmed.

## The four levels

| Level | Meaning | `containsPII` | `containsFinancialData` |
|---|---|---|---|
| `internal` | Aggregate/summary only — no individually-identifiable row, no money figures | `false` | `false` |
| `confidential` | Employee-level, non-financial — names, attendance, leave, headcount rolled up to a person | `true` (if row-level) | `false` |
| `restricted` | Financial data or identity documents, not statutory/bank-grade | varies | `true` |
| `highly_restricted` | Salary, bank details, PAN, UAN, ESIC, TDS — payroll/statutory data | `true` | `true` |

## Classification rules, in order

Apply the first rule that matches every column in the report. A report is classified at the level of its **most sensitive column**, not its average.

1. **Any column holding salary, wage, bank account/IFSC, PAN, UAN, ESIC, or TDS figures → `highly_restricted`.**
   Example: `payroll-salary-register` (`backend/src/modules/reporting/report-catalog.ts:1267`) — carries `basic_pay`, `gross_salary`, `pf_employer`, `pan_number`, `uan` in the same row → `highly_restricted`, `containsPII: true`, `containsFinancialData: true`, `exportRoles` limited to `["super_admin", "admin", "finance", "payroll"]`.

2. **Any column identifying an individual employee/candidate by name, contact, or personal attribute, with no salary/bank/statutory figure → `confidential`.**
   Example: attendance/leave/headcount-by-employee reports — row-level, person-identifiable, but no money column.

3. **Aggregate-only reports (branch/process/department totals, counts, rates) with no row traceable to one person and no money figure → `internal`.**
   Example: `headcount-by-department` (`report-catalog.ts:204`) — `department_name`/`process_name`/`active_headcount` are all group-level, no individual and no currency column → `internal`, `containsPII: false`, `containsFinancialData: false`.

4. **Anything crossing the Client Portal boundary → `restricted` minimum, regardless of content**, per `CLAUDE.md`'s Client Portal rule ("process-scoped client access only, with no payroll/PII leakage"). An aggregate that would be `internal` for internal viewers is still `restricted` if a client-facing surface can reach it, because the exposure risk is different for an external party.

## When in doubt: classify up, not down

If a report mixes column types or a column's sensitivity is ambiguous, classify at the higher of the two candidate levels. Over-restricting costs a legitimate viewer one extra permission request; under-restricting exposes salary/PAN/bank data. This principle is already how the existing 50 entries were judged — this document only writes it down.

## What this does not cover

- **Row-level access scoping** (branch/process/self-only visibility) is a separate mechanism (`branchScoped`, `processScoped`, row-level `WHERE` clauses) — classification controls *who can see the report at all*, not *which rows a permitted viewer sees*.
- **Export vs. view** are gated independently (`viewRoles` vs. `exportRoles`) — a role can often view a `restricted` report on-screen without being able to export/download it. This document does not set that split per-role; that remains a case-by-case call per report.
- **New reports added after this policy**: classify using the rules above, then this document does not need updating unless the rules themselves change — the point is that reclassification stops requiring a fresh judgment call each time.

---
*Written 2026-08-05 as part of the dashboard data-quality self-audit, ratifying the classification already applied to all 50 entries in `REPORT_CATALOG`. Needs compliance/security sign-off — see `OPEN_POLICY_QUESTIONS_2026-08-05.md` item 3.*
