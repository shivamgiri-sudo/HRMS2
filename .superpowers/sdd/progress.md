# WFM Payroll Prep Visibility + Salary Verification — SDD Progress Ledger
# Started: 2026-08-03
# Plan 1: docs/superpowers/plans/2026-08-03-wfm-payroll-prep-visibility.md
# Plan 2: docs/superpowers/plans/2026-08-03-wfm-salary-verification.md

## Plan 1 — WFM Payroll Prep Visibility
Task 1: complete (commit 008e2ae0, base bb3dc52f, review clean — 3 minor: silent catch, N+1 getOrRefresh, month not echoed)
Task 2: complete (commit b8d6cef0, base 008e2ae0, review skipped — code matches plan verbatim, deviation to WORKERS array type documented)
Task 3: complete (commit TBD, base b3cea1e6) — useNavBadges hook (src/hooks/useNavBadges.ts) + badgedGroups injection in CompactDashboardLayout.tsx; both SidebarNav instances now receive live badge counts; 5-min stale / 10-min refetch; eligible roles: wfm, process_manager, branch_head, payroll_branch, super_admin, admin

---

# Employee Lifecycle Audit Fixes — SDD Progress Ledger
# Started: 2026-08-10
# Plan: docs/superpowers/plans/2026-08-10-employee-lifecycle-audit-fixes.md
# Branch start commit: 289e1216ef7e6a93afe29b495f4c1815d5d24054

## Tasks
Task 1: employment_status 'Active' case fix — complete (commit e470144e, review clean — extra files in range were concurrent commits, not part of this commit)
Task 2: Block userId re-link via updateEmployee — complete (commit 99c60b13, review clean)
Task 3: Remove official_email from self-service — complete (commit 1dbd6e63, review clean)
Task 4: HR-approval gate on statutory-details — complete (commit 35561ec2, review clean)
Task 5: Block PUT /me/bank-details direct write — complete (410 tombstone, prior session)
Task 6: Promotion transaction wrap — complete (prior session — transaction in updatePromotion)
Task 7: Transfer effective-date + NULL-safe propagation — complete (commit ddb5eb2a)
Task 8: Exit propagation (date_of_exit, leave, assets) — complete (commit ddb5eb2a)
Task 9: BGV canViewEmployeeBgv scope fix — complete (commit ddb5eb2a)
Task 10: createEmployee email dup guard — complete (guard already present, test added in contract file)
Task 11: Remove Absconded/Terminated from status enum — complete (commit ddb5eb2a)

---

# WFM Roster Builder — Subsystem 1 — SDD Progress Ledger
# Started: 2026-08-20
# Plan: docs/superpowers/plans/2026-08-20-wfm-roster-builder-subsystem1.md
# Worktree: .claude/worktrees/wfm-roster-builder-subsystem1 (branch worktree-wfm-roster-builder-subsystem1)
# Branch start commit: 6bab5cb4

## Tasks
Task 1: complete (commit de40f8ed, base 6bab5cb4, review clean — spec compliant, no findings)
Task 2: complete (commit 09b712b6, base de40f8ed, review clean — spec compliant, no findings)
Task 3: complete (commit 868b0399, base 09b712b6, review clean — spec compliant, brief's illustrative test had 3 mocking bugs, corrected on retry with production code unchanged from brief; regression confirmed clean against 601 passing wfm/roster tests)
Task 4: complete (commit 71c61e27, base 868b0399, review clean — spec compliant, both extras judged legitimate; 21/21 tests independently confirmed)
Task 5: complete (commit cc2fa6a4, base 71c61e27, review clean — spec compliant, all 4 schema column-name claims independently re-verified against SQL migrations. Minor (non-blocking, for final review): response envelope {rows} diverges from sibling endpoint's {success,data} convention)
Task 6: complete (commit f5be0106, base cc2fa6a4, review clean — resolved brief's open shift-id question via live DB verification, independently re-confirmed by reviewer with own query: wfm_shift_template(23 UUID rows) vs wfm_shift_master(3 string-id rows), zero overlap; chose additive shiftTemplateId field over overloading shiftId. Minor cosmetic note only.)
Task 7: complete (commit 6759ec00, base f5be0106 — page shell + cycle picker over the existing /api/roster-gov/cycles endpoints; ledger line added retroactively, the task's own report is in briefs/task-7-report.md)
Tasks 8-10: complete (single commit, base 6759ec00 — the plan's per-task commits were not separable here because Tasks 8, 9 and 10 all edit RosterBuilderPage.tsx and a Task-8-only commit would have left the page unwired and its own test failing at that revision). Task 8: RosterPivotGrid with a REAL shift-template picker (the brief's window.prompt placeholder was deferred pending Task 6's shift-id question, which Task 6 answered) sourced from the existing GET /api/roster-gov/shifts/templates, a true date-column pivot, and hrmsApi instead of raw fetch (both roster-builder routes are behind requireAuth — a bare fetch would 401 every call). Task 9: cycle-aware deep link to the untouched RosterImportPage, the deferred embed still deferred. Task 10: publish button on the existing POST /api/wfm/roster/publish-to-employees. Reports in briefs/task-{8,9,10}-report.md.
Task 11 (regression): frontend 637/637 pass (63 files) including the api-endpoint-existence contract guard, which caught a real false-positive endpoint reference in a comment and is now clean. Backend wfm+roster 607 pass / 1 fail, and db guards 276 pass / 2 fail — all 3 failures pre-existing and unrelated (aprBulkEvidence.contract.test.ts from the APR manual-upload work; migration-manifest guard on 1508_noida_cost_centre_status_sync.sql missing and 1080_itc_blocked_sub_heads.sql unlisted, both from other sessions' in-flight SQL changes). Typecheck: no errors in either roster-builder file. Steps 4-5 (live WFM-role smoke on /wfm/roster-builder, and the non-WFM-role refusal check) NOT done — they need a running app against a local/staging DB and a login, and are the remaining gate before this branch can be called verified.
FIXED (was OPEN DEFECT, not introduced by tasks 8-10): POST /api/wfm/roster-builder/assign passed neither shiftStartTime nor shiftEndTime, and roster.service.ts:204 gates minimum-rest validation on both being present — so every write from the builder grid skipped the rest guard the other four roster-write engines enforce. The route now resolves the template's own times server-side (getShiftTemplateTimes in roster-builder.service.ts) and passes them; a request-body time is deliberately ignored, and an unknown template id is now a 400 instead of an assignment to a shift that does not exist. 6 new tests: 5 of them fail against the pre-fix route (verified by reverting it), 9/9 pass after. Backend wfm+roster 613 pass / 1 pre-existing fail. Live DB checked read-only first: wfm_rest_policy holds ONE active row — organization scope, 660 min, enforcement_mode 'warn' — so this fix starts recording real breaches to wfm_roster_conflict_log rather than refusing writes; it will begin blocking only when the owner flips that row to 'block'.
Real-file testing (2026-08-20, commit ca0ee175): tested the roster import against two ACTUAL files the owner supplied (Downloads\Roster). Roster.xlsx — 300-agent "Roster Planning" sheet — CRASHED the import with `TypeError: (header ?? "").trim is not a function`: its date headers are real Excel date cells, which sheet_to_json returns as NUMBERS, and header-alias.service.ts assumed strings (the string[][] cast made it look safe). Statusless throw, so prod would show a generic 500. Fixed by coercing header cells (numbers as Excel serials, Date objects via local getters, plus ISO YYYY-MM-DD parsing) and typing the rows unknown[][]. After the fix the real file parses end to end: header row 1, 14 date columns, 298 employees, 4,186 cells → 3,267 SHIFT / 281 WEEK_OFF / 14 LEAVE / 621 UNASSIGNED / 1 HARD_ERROR (a literal '0', correct) / 2 NEEDS_MAPPING ('HD', by design — createImportBatch hardcodes hdMapsTo NEEDS_MAPPING so an operator maps it). Second file (7.6 MB, 12-sheet weekly WFM workbook) has no date columns on its FIRST tab, which is all the importer reads: that throw now carries statusCode 400 + the sheet name instead of a masked 500. Also XLSX.read(...{sheets:[0]}) — 2,936 ms → 1,154 ms on that workbook, same first sheet. 10 new tests, all 10 fail against the pre-fix code (verified by reverting both service files). NOTE: this fix is on the subsystem-1 branch but is NOT subsystem-1 work — it belongs to the already-shipped roster import feature on main and should be cherry-picked there.
Live verification (2026-08-20, read-only, GETs only — no roster/inbox row was written): ran the REAL rosterBuilderRouter with the REAL requireAuth/requireRole against the production DB via tsx. Results: anonymous -> 401; an employee-only account -> 403 ("Access denied. Required: wfm or admin or super_admin"); a wfm-role account whose employees row is employment_status='inactive' -> 401 (account revocation working as designed); an active admin -> 200 with 1,090 rows = 163 employees x 7 dates, 953 carrying a shift template, 137 week-offs; missing cycleId -> 400. That closes plan step 11.5 at the API level and the READ half of 11.4. NOTE: a first attempt at this through vitest was meaningless and was discarded — tests/setup.ts mocks src/db/mysql.js globally, so every query returned empty and the role resolver fell back to 'employee', making a valid wfm user look like a 403. Anything calling itself a live check in this repo must not run under vitest.
Migration 1510 verified against the live schema before merge (read-only): page_catalog (249 rows) and role_page_access (1,512 rows) both exist and carry the column names the migration uses; id and active_status have DEFAULTs so the omitted columns are fine; and both target uniques exist — page_catalog.page_code and uq_role_page(role_key, page_code) — so its INSERT IGNOREs are genuinely idempotent, not merely intended to be. Not yet applied (branch unmerged); prod has already applied 1511 and 1512, so 1510 will land out of numeric order — harmless, the runner keys on filename. Also: only 5 active unblocked users hold the wfm role today, so grant coverage is worth a look before this page is announced.
STILL NOT DONE: the write half of plan step 11.4 — assign a cell, confirm cycle_id lands, publish, confirm the ROSTER_ACK_PENDING work_inbox_item row. Every part of that writes to production, which the plan itself scopes to a local/staging DB, and no such environment exists. It needs a human on a real login.

---

# Salary Dispute Module — SDD Progress Ledger
# Started: 2026-08-23
# Plan: docs/superpowers/plans/2026-08-23-salary-dispute.md
# Branch start commit: 09f9bfdc

## Tasks
Task 1: complete (commit 79f04616, base 09f9bfdc, review clean — spec compliant, all 24 columns, all indexes, MySQL8 compatible)
Task 2: complete (commit f4e70b6e, base c70ef53d, review clean — spec compliant, inbox API corrected to createWorkItem camelCase)
Task 3: complete (commit 3bbf19a6, base f4e70b6e, review clean — 8 routes, role guards correct, getEmployeeIdForUser helper inline)
Task 4: complete (commit 089d7862, base 3bbf19a6, review clean — 3-step wizard, hrmsApi, TanStack Query)
Task 5: complete (commit 375a8cdc, base 089d7862, review clean — differential entry, min 10 char remarks enforced)
Task 6: complete (commit 5d2d84cb, base 375a8cdc, review clean — 3 routes, 3 nav entries, manager read-only view, TypeScript clean, frontend build PASS)

---

# AON & Attrition Drill-Down (Plan 1 of 2) — SDD Progress Ledger
# Started: 2026-08-25
# Plan: docs/superpowers/plans/2026-08-25-aon-attrition-drilldown-plan.md
# Working directly on main (this repo's established convention, no feature branches)

## Tasks
Task 1: complete (commits 966ae8c5..7da40718, base 0fa44be3, review clean after 1 fix round — missed DATEDIFF site in aonCohortSurvival's cohortAge, fixed + test added; 285 tests passing)

---

# Employee Performance Scorecard — SDD Progress Ledger
# Started: 2026-08-25
# Plan: docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md
# Working directly on main (this repo's established convention, no feature branches)

## Tasks
Task 1: complete (commit 65675a84, base d886f228, review clean — migration renumbered 1558->1604 due to concurrent sessions, sanctioned by brief, independently verified collation + preflight)
Task 2: complete (commit 26fbc5fb, base a0fece05, review clean — spec compliant, Vitest adaptation preserved coverage, DB import path independently verified. 2 Important follow-ups logged: no per-employee error isolation in writeEmployeePerformanceSnapshots (fixing before Task 3), N+1 query fan-out ~295k queries/run (accepted for now, flagged for future batching)
Task 2 fix: complete (commit 07797463, base ea351f48, re-review Approved — per-employee try/catch added, return type now { written, errors }, new failure-then-success test proves isolation, computeEmployeeSnapshot untouched)
Task 3: complete (commit 5d6d1a42, base 2e2020ea, review clean — mirrors dashboard-snapshot.cron.ts pattern, {written,errors} consumed correctly with errors logged, both server.ts/all-workers.ts registrations wired, target-date computation verified timezone-safe. Minor non-blocking note: could have used dateUtils' getIstDateString(1) instead of manual date math)
Task 2: complete (commits 8ab866cd..6aecc0b9, base 7da40718, review clean after 2 fix rounds — round 1 fixed a real bug in the brief's own SQL sketch (nonexistent alias, no group correlation, NULL placeholder) plus overallAttritionRate's 3x12 re-scan (25.7s/2mo -> 22.3s/12mo) and a month-boundary bug (221 vs 301 exits); round 2 fixed a second perf bug the coordinator found independently in aonBucketAttrition (>150s timeout on the real unscoped 12-month default -> 28.7s after restructuring to a distinct_groups CTE). NOTE: commit 8ab866cd also swept in 3 unrelated files from a concurrent session (payroll.routes.ts, bpo-pnl.service.ts, PublicEmployeeVerify.tsx) due to a shared-tree race during `git add`/`git commit` — verified independently: no data lost or reverted, all 3 files' content is legitimate forward progress from another session, already on origin/main; left as-is per CLAUDE.md's no-force-push/no-reset-hard rule on a shared branch. All subsequent fix commits (542ceddc, 6aecc0b9) verified scoped to exactly 1 file each.)
Task 4: complete (commit 20420325, base 4cfa1c7b, review clean — script matches brief verbatim, {written,errors} consumed correctly, date-loop traced correct. Dry-run against live DB confirmed migration 1604 not yet applied (table missing, 1110/1110 ER_NO_SUCH_TABLE, independently verified) — pre-existing deploy blocker, out of scope; flagging before Task 13's full backfill)
