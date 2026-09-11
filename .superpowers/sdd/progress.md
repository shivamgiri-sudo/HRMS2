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
