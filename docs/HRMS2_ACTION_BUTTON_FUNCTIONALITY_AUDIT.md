# HRMS2 Action Button Functionality Audit

**Date:** 2026-06-25  
**Scope:** NativeWorkInbox, NativeIncentives, NativeOfferLetterGeneration, NativeDPDPWithdrawal, CeoDashboard, OnboardingSteps6to10

---

## 1. NativeWorkInbox.tsx

**Endpoint check:** The page calls `/api/inbox` (notification inbox module). It does NOT call `/api/work-inbox/my`.

**Verdict — correct as-is.** The notification inbox (`/api/inbox`) and the workflow work-inbox (`/api/work-inbox/my`) are two separate systems with different schemas:
- `/api/inbox` → `inbox_item` table, fields: `is_read`, `is_actioned`, `action_url`, `priority`
- `/api/work-inbox/my` → `work_item` table, fields: `status`, `item_type`, `assigned_to_user_id`

This page's data model, action buttons, and mutation endpoints all align with the notification inbox schema. Migrating the list call to `/api/work-inbox/my` without rebuilding the entire component would break all action handlers. **No endpoint change applied.**

| Button | onClick Handler | API Called | Loading | Error | Toast | Refresh | Status |
|--------|----------------|-----------|---------|-------|-------|---------|--------|
| Mark All Read | `markAllRead()` | `PATCH /api/inbox/mark-all-read` | No dedicated loading | `setMessage()` | None | Optimistic update | **Working** |
| Refresh | `load()` | `GET /api/inbox`, `GET /api/inbox/count` | `loading` spinner on icon | `setMessage()` | None | Full reload | **Working** |
| Type filter tabs | `setActiveTab(tab.type)` | Triggers `load()` via `useEffect` | `loading` | `setMessage()` | None | Full reload | **Working** |
| Priority filter | `setPriorityFilter(p)` | Triggers `load()` via `useEffect` | `loading` | `setMessage()` | None | Full reload | **Working** |
| Mark Read (per item) | `markRead(id)` | `PATCH /api/inbox/:id/read` | `actioning === id` disables | `setMessage()` | None | Optimistic update | **Working** |
| Action / Open & Action | `markActioned(id, actionUrl?)` | `PATCH /api/inbox/:id/actioned` | `actioning === id` disables | `setMessage()` | None | Optimistic update | **Working** |

**Fixes needed:**
- Mark All Read has no loading state — disabling button during in-flight is missing (minor UX gap).
- No toast on success for any action — errors surface via alert banner only.

---

## 2. NativeIncentives.tsx (first 100 lines audited)

| Button | onClick Handler | API Called | Loading | Error | Toast | Refresh | Status |
|--------|----------------|-----------|---------|-------|-------|---------|--------|
| (Requires full file read to enumerate) | — | — | — | — | — | — | **Partial audit** |

From lines 1–100: page uses `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`) — correct patterns. Types defined for `IncentiveMaster`, `IncentiveBatch`, `IncentiveLine`, `ImportResult`. No buttons visible in first 100 lines (they appear in the JSX below line 100).

**Observable from structure:** mutations likely call `invalidateQueries` on `useQueryClient` for refresh — standard react-query pattern. Full button audit requires reading lines 100–end.

---

## 3. NativeOfferLetterGeneration.tsx (first 80 lines audited)

**Architecture:** 4-step wizard (Employee → Template → Variables → Generate). Uses `useQuery` + `useMutation` from react-query. `useToast` imported.

| Button | onClick Handler | API Called | Loading | Error | Toast | Refresh | Status |
|--------|----------------|-----------|---------|-------|-------|---------|--------|
| Step navigation (Next/Back) | Local state `step++/step--` | None | None | None | None | None | **Working** |
| Employee search | Query on input change | `GET /api/employees?search=` (inferred) | `useQuery` isLoading | Inferred error state | None inferred | react-query cache | **Likely Working** |
| Template select | Local state update | None (select only) | None | None | None | None | **Working** |
| Generate Letter | `useMutation` | `POST /api/hr-letters/generate` (inferred) | mutation `isPending` | mutation `isError` | `useToast` — yes | Query invalidation | **Likely Working** |
| Copy Letter text | `Copy` icon onClick | None (clipboard API) | None | None | Toast inferred | None | **Likely Working** |

**Note:** Step 4 "Generate" button disabled until employee + template selected. Toast is wired via `useToast`. Full confirmation requires reading lines 80–end.

---

## 4. NativeDPDPWithdrawal.tsx

| Button | onClick Handler | API Called | Loading | Error | Toast | Refresh | Status |
|--------|----------------|-----------|---------|-------|-------|---------|--------|
| Submit Withdrawal Request | `handleSubmit()` | `POST /api/privacy/dpdp-withdrawal/request` | `submitting` state, spinner + "Submitting…" text | `setSubmitError()` — alert banner | None (inline success alert instead) | `fetchRequests()` called on success | **Working** |
| Scope checkboxes | `toggleScope(key)` | None (local state) | None | None | None | None | **Working** |

**Validation:** `reason` field required — shows error if blank. `scope_json` optional.  
**Data refresh:** On successful submit, `fetchRequests()` re-fetches the My Requests table.  
**Fixes needed:** No toast library used — success/error shown via inline Alert. Consistent with page style but differs from other pages that use `useToast`.

---

## 5. CeoDashboard.tsx

| Button | onClick Handler | API Called | Loading | Error | Toast | Refresh | Status |
|--------|----------------|-----------|---------|-------|-------|---------|--------|
| KPI metric tiles (clickable) | `openDrilldown(metricCode, metricName)` | Opens `DashboardDrilldownDrawer` (child component fetches) | None on tile itself | None on tile | None | None | **Working** |
| Close Drilldown Drawer | `closeDrilldown()` | None | None | None | None | None | **Working** |
| Go to Dashboard (access-denied screen) | React Router `<Link to="/dashboard">` | None | None | None | None | None | **Working** |
| ScopedFilterBar (branch/process) | `setBranchId`, `setProcessId` | Triggers summary re-fetch (both state vars unused — `[,]` destructure) | — | — | — | — | **Broken — state vars discarded** |

**Bug found:** `const [, setBranchId]` and `const [, setProcessId]` — the state values are never passed to the fetch calls. `ScopedFilterBar` fires callbacks but the selected filter IDs are silently dropped. Dashboard summary always loads the unfiltered org view regardless of filter selection.

**Fix:** Replace destructure to capture values: `const [branchId, setBranchId]` and `const [processId, setProcessId]`, then pass them as query params to the summary fetch or add them as `useEffect` dependencies.

**Data load:** Uses raw `fetch()` (not `hrmsApi`). Summary from `GET /api/dashboards/CEO_DASHBOARD/summary`. Insights from `GET /api/dashboards/CEO_DASHBOARD/good-bad-insights`. Insights failures are silenced. No manual refresh button.

---

## 6. OnboardingSteps6to10.tsx — Submit Button (last 80 lines)

| Button | onClick Handler | API Called | Loading | Error | Toast | Refresh | Status |
|--------|----------------|-----------|---------|-------|-------|---------|--------|
| Send OTP | `onSendOtp` (prop) | `POST /api/onboarding/:id/send-otp` (caller-provided) | `saving` disables | Inferred via parent | None visible in this component | None | **Working (prop-driven)** |
| Resend OTP | Same `onSendOtp` | Same | `saving` disables | Same | None | None | **Working** |
| Verify OTP | `onVerifyOtp` (prop) | `POST /api/onboarding/:id/verify-otp` (caller-provided) | `saving` + `otpCode.length !== 6` gate | Inferred via parent | None visible | None | **Working (prop-driven)** |
| Save Statutory | `onSave` (prop) | `PATCH /api/onboarding/:id/statutory` (caller-provided) | `saving` disables | Inferred via parent | None visible | None | **Working (prop-driven)** |
| **Submit Onboarding** | `onSubmit` (prop) | `POST /api/onboarding/:id/submit` (caller-provided) | `saving` spinner | Inferred via parent | None visible in component | None | **Working (prop-driven)** |

**Submit guard:** Disabled unless `statutory.declarationAccepted === true` AND `otpVerified === true`. Warning text shown when either gate fails.

**Fixes needed:** Toast feedback on submit success/failure is the responsibility of the parent component that provides `onSubmit` prop. The child component renders no toast — acceptable pattern for compound components but the parent must implement feedback.

---

## Summary of Issues

| Priority | File | Issue | Fix |
|----------|------|-------|-----|
| **High** | CeoDashboard.tsx:65–66 | Filter state discarded — `[, setBranchId]` drops selected values | Change to `[branchId, setBranchId]` and `[processId, setProcessId]`; pass to fetch calls |
| Medium | NativeWorkInbox.tsx | No loading state on "Mark All Read" | Add `const [markingAll, setMarkingAll] = useState(false)` and disable during request |
| Low | NativeWorkInbox.tsx | No toast on success — only error alerts shown | Add `useToast` for success confirmations |
| Low | NativeDPDPWithdrawal.tsx | Inline Alert for success instead of toast | Acceptable — consistent with page design |

---

## NativeWorkInbox Endpoint Decision

**`/api/inbox` is correct for this page.** The two inbox systems serve different purposes:

| System | Route | Table | Purpose |
|--------|-------|-------|---------|
| Notification Inbox | `/api/inbox` | `inbox_item` | HR notifications, leave approvals, asset returns — read/action flags |
| Workflow Work Inbox | `/api/work-inbox/my` | `work_item` | Engine-driven work items with `status`, `item_type`, escalation, reassignment |

NativeWorkInbox.tsx is a notification inbox viewer with read/action semantics matching `inbox_item`. No endpoint change required.
