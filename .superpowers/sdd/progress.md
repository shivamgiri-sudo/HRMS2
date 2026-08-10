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
