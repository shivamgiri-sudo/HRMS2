# Leave Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/leaves` as a role-aware workspace (My Leave / Approvals / History / Calendar) in the app's own theme colours, with correct Approve buttons, cancel-own-leave and balance cards.

**Architecture:** Backend adds a per-row `can_review` flag by factoring `canReviewLeave` into a reusable checker. Frontend splits the 1,400-line page into focused components under `src/components/leaves/`, driven by two pure modules (`leaveStatus.ts`, `leaveTheme.ts`) that hold the status/timeline/colour rules and are unit-tested. Existing hooks, apply form, export, discard and consent flow are reused unchanged.

**Tech Stack:** React + TypeScript, TanStack Query, shadcn/ui, Recharts, Tailwind theme tokens (`--primary`, `--chart-1..8`), Express + MySQL, Vitest.

Spec: `docs/superpowers/specs/2026-10-02-leave-page-redesign-design.md`

## File map
- Modify `backend/src/modules/leave/leave.secure.routes.ts` — `makeLeaveReviewChecker`, `canReviewLeave` delegates to it, list rows get `can_review`.
- Create `backend/src/modules/leave/__tests__/leave-can-review.test.ts`.
- Create `src/components/leaves/leaveStatus.ts` (+ `.test.ts`) — status normalisation, labels, timeline.
- Create `src/components/leaves/leaveTheme.ts` (+ `.test.ts`) — leave-type → chart token map.
- Modify `src/hooks/useLeaves.ts` — `canReview`, new status values, cancelled count, `useMyLeaveRequests`, `useCancelLeave`.
- Create `src/components/leaves/{LeaveHero,LeaveBalanceStrip,LeaveTimeline,MyLeaveTab,CancelLeaveDialog,ApprovalsTab,ReviewDialog,HistoryTab,LeaveCharts}.tsx`.
- Modify `src/components/leaves/LeaveRequestCard.tsx`, `LeaveCalendarView.tsx` — theme tokens.
- Rewrite `src/pages/Leaves.tsx` as a thin shell.

---

### Task 1: Backend `can_review`

**Files:** Modify `backend/src/modules/leave/leave.secure.routes.ts`; Test `backend/src/modules/leave/__tests__/leave-can-review.test.ts`

- [ ] **Step 1: Write the failing test** — `makeLeaveReviewChecker` returns a function `(target) => Promise<boolean>`. Cases: own request → false for everyone; super_admin → true; admin in scope → true, out of scope → falls through; exception-tier status needs the exception role; ordinary request → true only when caller is the effective approver; non-reviewable statuses (approved/rejected/cancelled) → false from the list annotator.
- [ ] **Step 2: Run** `cd backend && npx vitest run src/modules/leave/__tests__/leave-can-review.test.ts` — expect FAIL (function missing).
- [ ] **Step 3: Implement** — extract the body of `canReviewLeave` after the target fetch into `makeLeaveReviewChecker(userId)`, which resolves caller employee, `super_admin` and scoped-reviewer flags and reviewer scope ONCE, and caches exception-role and effective-approver lookups per leave type / employee. `canReviewLeave(userId, requestId)` fetches the row then calls the checker, so behaviour is identical. In `GET /requests`, select `e.branch_id AS emp_branch_id, e.process_id AS emp_process_id, e.reporting_manager_id AS emp_reporting_manager_id`, build one checker per request, and set `can_review` for `pending`/`pending_branch_head` rows (others `false`), computed in chunks of 10 concurrent lookups.
- [ ] **Step 4: Run** the new test plus `npx vitest run src/modules/leave tests/leave` — expect PASS.
- [ ] **Step 5: Commit** `feat(leave): per-row can_review on the leave list`.

### Task 2: Pure frontend modules

**Files:** Create `src/components/leaves/leaveStatus.ts`, `leaveStatus.test.ts`, `leaveTheme.ts`, `leaveTheme.test.ts`

- [ ] **Step 1: Write failing tests** for: `normalizeLeaveStatus` (maps `branch_head_approved`→`approved`, `branch_head_rejected`→`rejected`, `lapsed`→`lapsed`, unknown→`pending`), `isOpenStatus`, `statusLabel` (`pending_branch_head`→"Awaiting Branch Head"), `buildTimeline(request)` (steps submitted/manager/branch head/decision with `done|current|skipped`), and `leaveTypeToken(name)` (stable `--chart-n` per type, same input same token, never a hard-coded colour).
- [ ] **Step 2: Run** `npx vitest run src/components/leaves` — expect FAIL.
- [ ] **Step 3: Implement** both modules (pure, no React).
- [ ] **Step 4: Run** — expect PASS. **Step 5: Commit.**

### Task 3: Hooks

**Files:** Modify `src/hooks/useLeaves.ts`

- [ ] Add `canReview: boolean` to `LeaveRequest` and map `req.can_review`; widen `status` union with `branch_head_approved | branch_head_rejected | lapsed`; add cancelled count to `useLeaveStats`; add `useMyLeaveRequests()` (`GET /api/leave/requests/my`) and `useCancelLeave()` (`PATCH /api/leave/requests/:id/cancel {reason}`, invalidating `leave-requests`, `leave-stats`, `leave-balances`, `my-leave-requests`). Extend `useLeaves.fetch.test.ts` for the new mapping. Commit.

### Task 4: Components
Build, each as its own small file with a render test using `renderToStaticMarkup`: `LeaveHero`, `LeaveBalanceStrip` (reuses `useLeaveBalances`), `LeaveTimeline`, `CancelLeaveDialog`, `MyLeaveTab`, `ReviewDialog` (approve with optional remark / reject with required remark), `ApprovalsTab`, `HistoryTab` (current filters + cancelled), `LeaveCharts` (Recharts, `hsl(var(--chart-n))`). Restyle `LeaveRequestCard` and `LeaveCalendarView` to theme tokens. Commit per component.

### Task 5: Page shell
Rewrite `src/pages/Leaves.tsx` to compose the above; tabs by role (`Approvals` only when any loaded row has `canReview`; `History` for HR/admin roles via `useIsAdminOrHR`); keep `LeaveConsentBanner`, `AIInsightPanel`, export, discard, truncation notice, error/retry. Apply dialog closes on success. Commit.

### Task 6: Verify and ship
- [ ] `npx vitest run` (frontend and backend), `tsc --noEmit` both projects.
- [ ] Push, deploy, then live-check in the browser: balance strip, apply, cancel, approve/reject with marked test requests, export, role tabs, charts colours.
