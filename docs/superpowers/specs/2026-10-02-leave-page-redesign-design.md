# Leave page redesign (/leaves) — design

Approved by the owner on 2026-10-02. First page of a wider UI refresh; the structure, colour rules and
component split below are the template for the other pages.

## Goals
- One role-aware workspace instead of one scope-wide list that mixes personal, approver and HR views.
- Everything an employee needs is on the page: balances, own requests with status steps, apply, cancel.
- Approve/Reject buttons appear exactly where the server will accept the action.
- Colours and charts come only from the app theme tokens (MAS Blue `--primary` #1B6AB5, deep navy sidebar,
  `--chart-1..8`, shared StatusBadge colours). No hard-coded pink/purple/black.
- Nothing that works today is lost.

## Layout
- Header: MAS blue gradient (deep navy → #1B6AB5), rounded-3xl, glass stat chips, **Apply for leave**,
  Export (HR roles). `LeaveConsentBanner` stays above it.
- Balance strip above the tabs: one card per leave type (remaining/used, progress bar, CL+ML pool note).
- Tabs by role:
  - **My Leave** (everyone): own requests from `GET /api/leave/requests/my`, newest first, with a step
    timeline (submitted → manager → branch head if escalated → decision); **Cancel** on pending/approved
    (reason + confirm) via `PATCH /api/leave/requests/:id/cancel`; overview charts (monthly, by type).
  - **Approvals** (only when the caller can review at least one request): queue, sort, pagination,
    "Escalated to Branch Head" tag; one-click Approve with optional remark; Reject needs a remark.
  - **History** (HR/admin roles): current filters (+ cancelled status), sort, pagination, truncation
    notice, export, Discard (super_admin/wfm).
  - **Calendar**: existing approved-leave month view, restyled.
- `AIInsightPanel` kept.

## Colour and charts
- Tokens only. Charts use `hsl(var(--chart-n))`; one leave-type→token map (`leaveTheme.ts`) feeds cards,
  charts, legends and the calendar. Status pills use `StatusBadge`. Charts have axes, legends, tooltips and
  do not rely on colour alone.

## Correctness
- Backend: `GET /api/leave/requests` rows gain `can_review` (same rules as `canReviewLeave`: no self-approval;
  admin/super_admin; hr in branch scope; exception tier needs the exception-approver role; otherwise the
  effective approver). Stats gain a cancelled count.
- Frontend: handle `branch_head_approved`, `branch_head_rejected`, `lapsed`; escalated rows no longer appear
  in both Pending and Processed; Apply dialog closes on success; buttons driven by `can_review`.

## Structure
`src/pages/Leaves.tsx` → thin shell. New in `src/components/leaves/`: `LeaveHero`, `LeaveBalanceStrip`,
`MyLeaveTab`, `ApprovalsTab`, `HistoryTab`, `CancelLeaveDialog`, `ReviewDialog`, `leaveTheme.ts`,
`leaveStatus.ts` (status mapping + timeline derivation). Existing hooks, the apply form rules, export,
discard and consent flow are unchanged.

## Out of scope
Holidays on the calendar, raise-on-behalf entry point, reconciliation UI, any change to leave policy rules.

## Testing
Unit tests: status mapping, timeline, filters, theme map. Backend tests: `can_review`, cancelled stat.
Full suites. After deploy, live check in the browser (apply, cancel, approve, reject with marked test
requests; export; role tabs).
