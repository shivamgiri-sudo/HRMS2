# Task 13 Brief: Final regression run + historical backfill attempt

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 13) — reduced scope: the plan's originally-envisioned "RBAC regression test" is already substantially covered by Task 7's route tests (5 test cases including scoped-rows, 400-missing-dates, 403-no-grant, 403-fail-closed-null-scope, and the scoped-vs-org-wide distinction) and Task 5's dashboard-access-registry test (13/13 role-matrix assertions). This task instead focuses on: (a) running the full backend test suite to confirm no regressions across all 12 prior tasks' combined changes, and (b) attempting the historical backfill, honestly reporting whatever happens.

## Known constraint going in

`employee_performance_daily_snapshot` (migration 1604) and the `page_catalog`/`role_page_access` seed (migration 1607) are both registered but NOT YET APPLIED to the live database — this repo applies pending migrations at the next backend restart/deploy, which hasn't happened during this plan's execution (a known, pre-existing, out-of-scope deploy-timing gap, confirmed independently in Task 4). This means the backfill script will almost certainly fail with `ER_NO_SUCH_TABLE` again, exactly as it did in Task 4's single-day dry run. **This is expected and not a defect in this task's work** — report it honestly, do not treat it as a blocker, and do not attempt to apply the migration yourself (that's a deploy action requiring separate explicit approval per CLAUDE.md).

## Task

**No new files.** This task runs verification only.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test 2>&1 | tail -80` (or whatever the real full-suite command is per `package.json` — confirm first if `npm test` isn't it).
Expected: paste the REAL output. Compare against this plan's known CI baseline (per project memory, a small number of pre-existing unrelated failures on a near-zero baseline is normal) — flag ONLY new failures that trace to files this plan touched (list is in the plan document's File Structure section, or check `git log --oneline` for all commits from this plan by searching the ledger at `.superpowers/sdd/progress.md`'s "Employee Performance Scorecard" section for the full commit list).

- [ ] **Step 2: Run the frontend test suite (if one exists and is fast)**

Check `package.json` for a frontend test script (distinct from `npm run typecheck`). If one exists, run it and report results the same way as Step 1. If none exists, state that explicitly.

- [ ] **Step 3: Attempt the backfill for a short recent range**

Run: `cd backend && npx tsx scripts/backfill-performance-scorecard-snapshot.ts 2026-08-18 2026-08-24` (one week, not the full historical range — keep this short given the expected failure mode).
Expected: most likely `ER_NO_SUCH_TABLE` for every employee on every day, exit code 1 — this is fine, paste the real output and say so plainly. If it unexpectedly SUCCEEDS (meaning the migration got applied by a concurrent session's deploy during this plan's execution), report the real written/error counts instead — do not assume either outcome, run it and report what actually happens.

- [ ] **Step 4: Write a final plan-completion summary**

Read `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` and `.superpowers/sdd/progress.md`'s "Employee Performance Scorecard" ledger section (all prior task entries) and write a concise summary covering:
- All 12 prior tasks' final status (complete/fixed, referencing key commit SHAs from the ledger)
- The two Critical/security findings that were caught and fixed during review (Task 5's RBAC over-grant, Task 7's fail-closed scoping gap, Task 11's concurrent-session migration column regression)
- What remains for this feature to be LIVE and usable: (1) a backend deploy/restart to apply migrations 1604+1607, (2) the historical backfill actually run once the table exists, (3) manual browser verification (not possible in any sandboxed environment used throughout this plan's execution)
- Confirm nothing was pushed to GitHub during this plan's execution (all work is local-`main`-only commits, per explicit instruction)

## Report contract

Write your full report — including the final plan-completion summary from Step 4 — to `.superpowers/sdd/employee-performance-scorecard/reports/task-13-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / BLOCKED
- Test suite results (real pass/fail counts, both backend and frontend if applicable)
- Backfill attempt result (real output)
- A 3-5 sentence summary of what's ready and what remains before this feature can go live

## Important

- Do NOT push to GitHub.
- Do NOT apply migrations, restart the backend, or attempt any deploy action.
- Do NOT modify any file — this is a verification-and-reporting-only task, no commits expected unless you discover something that genuinely needs a trivial fix (in which case, treat it like any other fix: minimal, tested, committed with an explicit file list, and flagged clearly in your report as an addition beyond the original task scope).
- If you have questions before starting, ask them instead of guessing.
