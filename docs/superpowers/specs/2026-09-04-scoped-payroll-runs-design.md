# Branch + cost-centre scoped payroll runs

**Date:** 2026-09-04
**Status:** approved for implementation
**Affects:** payroll run creation, employee selection, salary register, statutory outputs

---

## Problem

Payroll can only be run for the whole company. All 104 runs in `salary_prep_run` are company-wide:
`branch_filter` and `process_filter` are NULL on every row, and `branch_id`/`process_id` are NULL on
every row. One blocked branch therefore holds up everyone. Measured 2026-09-04, August 2026 stands at
52 branch/process rows `blocked`, 6 `in_progress`, 0 Branch Head sign-offs — while three HEAD OFFICE
cost centres have already completed all three attendance approval stages and could be paid.

Two capabilities exist but are unreachable:

* The API accepts `branchFilter`/`processFilter`, the calculator honours them, and the table already
  carries `uq_run_month_branch_process` — the schema was designed for one run per month per
  branch/process. The UI sends only `{ runMonth }` ([usePayroll.ts:293](../../../src/hooks/usePayroll.ts#L293)).
* Cost centre is not supported at all: no column on the run, no filter in the calculator.

There is also a live correctness bug in the unused path. `branch_filter` resolves through
`WHERE branch_name = ?`, and branch names are **not unique** — HYDERABAD, JAIPUR, JAIPUR IDC, KARNAL,
MEERUT and MOHALI each name two rows in `branch_master`, and several process names collide too. A run
for "JAIPUR" would silently pay both Jaipur branches. Any move to scoped runs must switch to ids.

## Decisions taken

| Decision | Choice |
|---|---|
| Run unit | Branch + cost centre, multi-select, may span branches |
| Statutory + bank outputs | Consolidated per month across all runs |
| Month completeness | Coverage tracked; close blocked below 100% of active employees |
| Legacy runs | Preserved unchanged; scoped-only for new months |
| First scoped month | August 2026, with company-wide retained as fallback |
| Run authority | Payroll Head (HO) only; branch roles never calculate payroll |
| Cost centre on a line | Stamped at calculation time |

## Data model

Three additive columns and one new table. Nothing existing changes.

```
salary_prep_run_scope
  id, run_id, run_month, branch_id, cost_centre_id, created_at
  UNIQUE (run_month, cost_centre_id)
  INDEX (run_id)

salary_prep_run
  + scope_kind ENUM('company','scoped') NOT NULL DEFAULT 'company'

salary_prep_line
  + branch_id CHAR(36) NULL
  + cost_centre_id CHAR(36) NULL
```

`UNIQUE (run_month, cost_centre_id)` is the double-payment guard, and it is deliberately in the
database rather than in application code: a cost centre can belong to exactly one live run per month,
and a second attempt fails as a constraint violation instead of relying on a check someone can forget
to call. Cancelling a run deletes its scope rows, releasing those cost centres for a new run.

The stamp on `salary_prep_line` is what makes the register stable. `employees.cost_centre_id` is
current-state only — `employee_cost_centre_allocation` has effective dating but holds 0 rows — so a
register that derives cost centre from the employee changes retroactively when someone transfers. A
closed month must not move. The stamp also makes "which cost centres have been paid" answerable from
the lines directly.

Legacy runs get `scope_kind = 'company'` and no scope rows; their lines keep NULL stamps. No backfill.

## Employee selection

Two places select the run's population and they must agree, or readiness checks one set of people and
the calculator pays another:

* `runEmployeeScopeSql()` in `payroll-governance.service.ts` — readiness/blockers
* the employee query in `payrollCalculate.service.ts` (~line 746) — what actually gets paid

Both gain the same branch: when `scope_kind = 'scoped'`, restrict to
`e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)`. When
`scope_kind = 'company'`, behaviour is exactly as today, including the existing name-based filters,
so the 104 historical runs recompute identically if ever reopened.

Selection is by **id**. The name-matching path is not extended to cost centres and is left in place
only for legacy company runs.

## Run creation and authority

`POST /api/payroll/runs` accepts `costCentreIds: string[]`. Validation:

1. Non-empty; every id exists, is active, and belongs to an active branch.
2. None already claimed by a live run for that month (checked inside the existing `GET_LOCK`, then
   enforced again by the unique key — the check gives a readable error, the key guarantees the rule).
3. Branches derived from the cost centres, not sent by the client.

`payroll_head` is added to the role lists for `POST /runs` and `POST /runs/:id/calculate`; it is
absent today, so the role chosen to own this cannot currently do it. Branch roles are not added.

The route's scope guard currently resolves `req.body.branch_id`, which the API never sends, so the
row-scope check sees no branch. It will resolve the branches derived from the selected cost centres.

## Month coverage gate

New `GET /api/payroll/runs/coverage?month=YYYY-MM` returning, for the month:

* every active cost centre with its run status — `paid`, `in_run`, or `not_started`
* employees not covered by any run, including the 2 active employees with no `cost_centre_id`, listed
  explicitly as an exception rather than silently omitted
* a `complete` boolean, true only when every active payable employee sits in exactly one run

Month close is refused while `complete` is false. The 2 unassigned employees must be given a cost
centre or explicitly excluded by the Payroll Head with a reason; they are never dropped quietly.

## Statutory and bank outputs

PF ECR, ESIC challan, TDS and the NEFT payment file are generated **per month**, assembled across all
of that month's runs, because that is how they are filed and paid. Existing per-run endpoints keep
working for company runs. New month-level endpoints aggregate `salary_prep_line` for every run whose
`run_month` matches, so a month paid in six runs still files one challan and one bank file.

## Salary register

The register must show only what has actually been run. `GET /runs/:id/salary-sheet-export` already
row-filters to the caller's branch/process scope and already emits a `CostCenter` column, so this is a
filter change:

* a scoped run's register covers exactly its own cost centres, read from the line stamps
* a month-level register unions the month's runs, still intersected with the viewer's own scope
* cost centres with no completed run do not appear at all — not as empty rows

## UI

**Run creation** — a branch/cost-centre picker showing **active branches only** (6 today; 4 hold
staff), each expanding to its cost centres with headcount. Multi-select within a branch and across
branches. Closed set, so selection is checkbox/dropdown throughout with no free text, per the Form
Input Rule in CLAUDE.md. Selecting a branch selects its cost centres; a cost centre already claimed by
another run for that month is shown disabled with the run it belongs to.

**Coverage panel** — cost centres paid / in run / not started for the month, plus uncovered employees,
so the Payroll Head can see what remains before close.

## Testing

Unit and contract tests:

* the unique key rejects a second run claiming the same cost centre in the same month
* readiness and calculator select an identical employee set for the same scoped run — the invariant
  that keeps blockers and payment in agreement
* a company run's population is byte-identical before and after the change (legacy runs unaffected)
* name-collision regression: a scoped run never resolves employees through `branch_name`
* line stamps are written, and a later cost-centre transfer does not alter a closed month's register
* coverage reports `complete: false` while any active employee sits outside every run

Live verification on **HEAD OFFICE**, chosen because it is small enough to check by hand — 4 cost
centres, 15 payable employees:

| Cost centre | Staff |
|---|---|
| MANAGEMENT-CORPORATE | 7 |
| FINANCE/ACCOUNTS | 4 |
| BSS/BLD/CORP/796 | 3 |
| IT/SYSTEM | 1 |

The test run selects these four, and the resulting line count must be exactly 15, with every line
stamped to HEAD OFFICE and to the cost centre the employee belongs to. The register for that run must
show those 15 and nobody else, and no other branch's cost centres.

## Rollout

Migration `1671` is additive and safe to apply ahead of the code. Company-wide runs remain available
as August's fallback: if scoped runs are not verified in time, August runs the existing way and
September becomes the first scoped month. Nothing about this change alters per-employee salary
arithmetic — it changes only which employees a run selects, and records where they were paid.

## Non-goals

* No change to salary calculation. `running-salary.service.ts` and the arithmetic in
  `payrollCalculate.service.ts` are called, never modified.
* No backfill of the 104 legacy runs.
* No activation of `employee_cost_centre_allocation`; split allocation across cost centres is out of
  scope and would need its own backfill and maintenance UI.
* Process-level scoping is not extended; cost centre supersedes it for new runs.
