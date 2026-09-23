# HRMS2 Issue Fixes Sprint — SDD Progress Ledger

Started: 2026-09-11
Base commit: dcc32a7d165b343746693f7291b83f7e4aa87d82
Branch: worktree-hrms2-issue-fixes

## Completed Tasks

- [x] T01: localDate.ts utility + timezone fixes (HR-013/014/015) — commit 37b04ec3
- [x] T02: safeCsv.ts utility + CSV injection fix + AlertDialog (HR-034/035) — commit 37b04ec3
- [x] T03: P1 Security batch — portal crypto OTP, async session, impersonation route (HR-004/005/006/007) — commit 4e62c427
- [x] T04a: Assets transaction history drill-down (HR-008) — commit 37b04ec3
- [x] T04b: Asset type enum dropdown (HR-009) — commit 033e13ac
- [x] T05: Quality trend real calc (HR-010) — commit 37b04ec3
- [x] T06: Reimbursement column fix (HR-023) — commit 37b04ec3
- [x] T07: KPI missing actuals excluded from score (HR-024) — commit 37b04ec3
- [x] T08: KPI payload + scope fix (HR-002/003) — commit 37b04ec3
- [x] T09: Error states P1 batch (HR-019/020/021/022/025/026/029) — commit 7b59bfaa
- [x] T10: Build infra — AlertDialog, demo routes, mapping gaps (HR-037/040/043) — commit 37b04ec3
- [x] T11: Leave reconciliation screen (HR-044) — commit 37b04ec3
- [x] T12: Exit management merge (HR-017) — commit d3ac542b
- [x] T13: Route inventory report (HR-038) — commit 7186ee76
- [x] T14: Google Sheets removal (HR-011), org-chart settings hidden (HR-018) — commit d3ac542b
- [x] T15: LMS SSO on-demand token (HR-033) — commit 033e13ac
- [x] HR-012 (CSV bulk upload naive split): NON-ISSUE — APR upload fields (employee_code, attendance_date, net_login_minutes) never contain commas; no fix needed

## Remaining (NI = Non-Issue, OOS = Out of Scope)

- HR-012: NI — field types cannot contain commas; naive join is safe
- HR-028, HR-030, HR-036, HR-041, HR-042, HR-045, HR-046: P3 — deferred, no sprint scope
- HR-039 (TS strict mode): deferred — infrastructure-wide, separate sprint

---

# Transition Manager Gaps — SDD Progress Ledger

Started: 2026-09-22
Base commit: 33f359c12a9c9590da2c04058c2eb324e2923905
Branch: worktree-transition-manager-gaps
Plan: docs/superpowers/plans/2026-09-22-transition-manager-gaps.md

## Completed Tasks

- [x] Task 1: extract getLastWorkedDate (commit 33f359c1..2d1347c0, review clean)
- [x] Task 2: AWOL confirm/reject service — commit 6765469a
- [x] Task 3: AWOL routes — commit cea132dc
- [x] Task 4: expose item_type on PendingTask (backend) — commit 21b94991
- [x] Task 5: frontend Confirm Absconding UI — commit adf75586
- [x] Task 6: 4-hour repeat reminder dedupe key — commit 8c988d74
- [x] Task 7: additive bgv_result migration — commit ab75d35b (not executed against any DB; schema-snapshot.json updated by hand, schema-column-refs guard passes)
- [x] Task 8: HR_BGV_INITIATION task — commit 7fd74890 (not manually verified against a running server/sandbox DB)
- [x] Task 9: frontend BGV completion UI — commit 688b290a (not manually verified in browser; tsc clean, drift contract test passes)

## Remaining

None — all 9 tasks complete. Outstanding before shipping: run migration 1842 against a real sandbox DB and manually verify Tasks 5, 8, 9 in a browser (no local DB/browser available in this session).
