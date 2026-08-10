# HRMS Button Action Audit — ATS & Inbox Pages
**Audit Date:** 2026-06-25
**Scope:** src/pages/ — NativeATSOnboardingBridge, NativeATSCandidateMaster, NativeATSRecruiterWorkspace, NativeATSWaitingQueue, ATSCommandCentre, NativeATSFullParityCommandCenter, NativePayrollHRValidation, NativeWorkInbox

---

## 1. NativeATSOnboardingBridge.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Refresh | `load()` | GET `/api/ats/onboarding-bridge` | Reload candidate list | **BROKEN — route missing** |
| Send Onboarding Link | `handleSendToken(candidate_id)` | POST `/api/ats/onboarding/send-token/:candidateId` | Send secure onboarding link | OK |
| Resend Link | same as above | same | Resend link to candidate | OK |

### Flags

- **CRITICAL: GET `/api/ats/onboarding-bridge` does not exist.** `atsRouter` only defines `POST /onboarding-bridge` and `PATCH /onboarding-bridge/:id`. The controller handler `listOnboardingBridges` exists but is never mounted as a `GET` route. Every page load returns a 404. Fix: add `atsRouter.get("/onboarding-bridge", requireRole("admin","hr"), h(c.listOnboardingBridges.bind(c)));` to `ats.routes.ts`.
- `handleSendToken` has loading state (`sendingToken`) and shows message on success/error. No toast — uses inline message banner. Acceptable.
- `handleSendToken` success calls `load()` which will itself fail (see above).

---

## 2. NativeATSCandidateMaster.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Refresh Data | `loadData()` | GET `/api/ats/candidates?limit=500&page=1` | Reload all candidates | OK |
| View (per row) | `setSelected(r)` | None (client-side panel update) | Show candidate journey in right panel | OK |
| View Employee Profile | `<a href="/employees?search=...">` | None (link navigation) | Open employee in HRMS | OK |

### Flags

- `loadData()` has no per-field error handling on the enrichment path — enrichment silently drops fields (`latestSubmission: undefined`) and logs no warning if backend returns unexpected shape.
- No loading indicator for the "View" row button itself (instant, acceptable).
- `loadData` pre-selects `enriched[0]` on load, which may surprise users on large lists — minor UX issue not a bug.

---

## 3. NativeATSRecruiterWorkspace.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Refresh | `refresh()` | GET `/api/ats/recruiter/my-candidates` + `/api/ats/recruiter/submission-history` | Reload pending queue and history | OK |
| Pending Queue (tab) | `setTab('pending')` | None | Switch tab | OK |
| Submission History (tab) | `setTab('history')` | None | Switch tab | OK |
| Open (per candidate) | `openForm(c)` | None (local state) | Open submission form | OK — guarded by `!recruiterProfile` |
| Resubmit (history row) | `openForm(...)` | None (local state) | Open form pre-filled | OK — only enabled when `final_decision === 'Client Round - Pending'` |
| Refresh (in history tab) | `refresh()` | same as above | Reload data | OK |
| Submit Update | `submit()` | POST `/api/ats-full-parity/recruiter-submission` | Save interview update | OK |
| Back | `setScreen('workspace')` | None | Return to workspace | OK |

### Flags

- `loadPending()` and `loadHistory()` have **no individual try/catch**. They are called inside `Promise.all` wrapped in a single try/catch in `loadWorkspace()` and `refresh()`. If one fails the other's state is also lost — silent partial failure. The error detail (`err?.response?.data?.message`) is shown but does not identify which call failed.
- `submit()` has proper loading state (`disabled={loading}`), error display, and success confirmation. Route is mounted and implemented.
- History tab date filters `fromDate`/`toDate` are `readOnly` (no setter exposed in useState). Users cannot change the date range from the UI — the filters are visible but non-functional. Not a critical bug but misleading.

---

## 4. NativeATSWaitingQueue.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Command Center (link) | `<a href="/ats/dashboard">` | None | Navigate to command center | OK |
| Refresh | `load()` | GET `/api/ats/candidates?limit=500&page=1&stage=Applied` | Reload waiting queue | OK |

### Flags

- **Read-only view page** — no state-changing actions. No flags beyond the `stage=Applied` filter which on the backend's `GET /api/ats/candidates` actually filters by `current_stage`. Backend field mapping depends on query param name matching — low risk.
- No "Assign Recruiter" button despite the page noting "Unassigned" count in the SLA stat. The stat is display-only; assignment must be done elsewhere.

---

## 5. ATSCommandCentre.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Timeline period select | `setTimelineDays(n)` → `useEffect` | GET `/api/ats/command-centre/timeline?days=N` | Reload chart | **BROKEN — route not mounted** |

### Flags

- **CRITICAL: `/api/ats/command-centre/*` routes are NOT mounted in `app.ts`.** `commandCentreRouter` is defined in `command-centre.routes.ts` but never imported or `app.use()`'d anywhere. All four load functions (`loadMetrics`, `loadTimeline`, `loadBranches`, `loadRecruiters`) hit 404. The page shows a full-screen spinner indefinitely or an error banner.
- `loadMetrics`, `loadTimeline`, `loadBranches`, `loadRecruiters` each have **no individual try/catch** — called inside a single `Promise.all` catch. One failure kills all data.
- No `setLoading(false)` in loadTimeline (called separately by `useEffect` on `timelineDays`). If this standalone call fails, `loading` state could remain stale.
- The page has no Refresh button — data is loaded once on mount only (unless timeline period changes).

---

## 6. NativeATSFullParityCommandCenter.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Refresh | `load()` | GET `/api/ats-full-parity/web-data?...` | Reload all dashboard data | OK |
| Run SLA | `runSla()` | POST `/api/ats-full-parity/jobs/sla-check` | Trigger SLA check job | **PARTIAL — no loading state on button** |
| Repair | `runRepair()` | POST `/api/ats-full-parity/jobs/repair` | Trigger data repair job | **PARTIAL — no loading state on button** |
| Daily Report Preview | `previewDailyReport()` | GET `/api/ats-full-parity/daily-report/snapshot?mode=preview` | Preview daily report | **FLAG — uses `alert()` for success; no error display path** |
| Tab buttons (Cover, Dashboard, Trends, etc.) | `setTab(t)` / `loadHealth()` | GET `/api/ats-full-parity/health` (Health tab only) | Switch tab or load health | OK |
| Search (Journey) | `runJourney()` | GET `/api/ats-full-parity/journey?query=...` | Lookup candidate journey | OK — has loading state and error display |

### Flags

- **Run SLA** and **Repair** buttons have `onClick` but no `disabled` attribute during execution. User can double-click and fire multiple concurrent mutations. Add a `running` state and `disabled` guard.
- **Daily Report Preview** uses `alert()` (native browser dialog) for success feedback. This is inconsistent with the rest of the UI and blocks the tab. Replace with inline message or toast.
- `previewDailyReport()` has no error display path — catch sets `setError(...)` but the function swallows on success with `alert()`. Error would correctly show in the error banner.
- `loadHealth()` has no loading indicator other than `healthLoading` — not displayed in the Health tab render (check if `healthLoading` is used in JSX).

---

## 7. NativePayrollHRValidation.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Candidate card (list) | set view to 'validate' | None (local state) | Open validation form | OK |
| Back to List | reset view to 'list' | None | Return to list | OK |
| Calculate Breakdown | `calculateBreakdown()` | POST `/api/ats/payroll-hr/calculate-breakdown` | Show salary split | **BROKEN — router not mounted** |
| Cancel | reset view to 'list' | None | Discard and return | OK |
| Save & Send for Approval | `handleSubmit()` | POST `/api/ats/payroll-hr/validate` + GET `/api/ats/payroll-hr/pending-candidates` (on load) | Save salary validation | **BROKEN — router not mounted** |

### Flags

- **CRITICAL: `payrollHRRouter` is defined in `payroll-hr.routes.ts` and exported but never imported or mounted in `app.ts`.** All calls to `/api/ats/payroll-hr/*` return 404. The page loads but every action fails silently or with an error banner. Fix: add `import { payrollHRRouter } from "./modules/ats/payroll-hr.routes.js";` and `app.use("/api/ats/payroll-hr", payrollHRRouter);` to `app.ts`.
- `loadMasterData()` failure is **silently swallowed** with only `console.error`. All dropdowns (Company, Designation, Department, Process, Cost Centre, Reporting Manager, Shift) remain empty with no user-visible error.
- `calculateBreakdown()` requires `formData.gross_salary > 0` and `formData.salary_slab_id` — both reasonable guards. Has loading state `calculatingBreakdown`. Error shown in inline banner.
- `handleSubmit()` has `disabled` guard on joining_date + salary_slab_id + gross_salary, loading state `submitting`. Success auto-redirects after 2s timeout — acceptable.
- Master data endpoint `/api/employees?role=manager` uses a `role` query param that the employee list endpoint may not support — requires verification.

---

## 8. NativeWorkInbox.tsx

| Button Label | onClick | API Called | Expected Result | Status |
|---|---|---|---|---|
| Mark All Read | `markAllRead()` | PATCH `/api/inbox/mark-all-read` | Mark all unread items read | **ROUTING BUG — shadowed by `/:id/read`** |
| Refresh | `load()` | GET `/api/inbox?...` + GET `/api/inbox/count` | Reload inbox | OK |
| Type filter tabs (All, Leave Approvals, etc.) | `setActiveTab(tab.type)` | triggers `useEffect` reload | Filter by type | OK |
| Priority filter buttons | `setPriorityFilter(p)` | triggers `useEffect` reload | Filter by priority | OK |
| Mark Read (per item) | `markRead(id)` | PATCH `/api/inbox/:id/read` | Mark single item read | OK |
| Action / Open & Action | `markActioned(id, actionUrl)` | PATCH `/api/inbox/:id/actioned` | Mark actioned + open URL | OK |

### Flags

- **ROUTING BUG: `PATCH /mark-all-read` is registered AFTER `PATCH /:id/read` in `inbox.routes.ts`.** Express matches routes in declaration order; `/:id/read` will match the path `/mark-all-read/read` — but the actual PATCH to `/mark-all-read` (without trailing `/read`) calls a different pattern and should be fine on its own. However the issue is that `/mark-all-read` (line 54) is declared after `/:id/read` (line 40) and `/:id/actioned` (line 47), meaning Express could match `mark-all-read` as an `:id` value. In practice `/mark-all-read` is a PATCH to exactly that path, not `/:id/read`, so it resolves correctly — but it is fragile ordering. Reorder `/mark-all-read` before `/:id/*` patterns for safety.
- `markAllRead()` has **no loading state or disabled guard** — user can spam-click. Add an `allReading` state.
- `markAllRead()` catches errors but the error is set in `setMessage()` which also shows success messages — there is no visual distinction between success and error in the message banner (both use `amber` styling). Minor UX issue.
- `markActioned()` calls `window.open()` inside a try block — if the URL is malformed, the open silently fails but the item is still marked actioned.

---

## Summary of Critical Issues

| Severity | Page | Issue |
|---|---|---|
| CRITICAL | NativeATSOnboardingBridge | GET `/api/ats/onboarding-bridge` not registered in `ats.routes.ts` — page always fails to load |
| CRITICAL | ATSCommandCentre | `commandCentreRouter` not mounted in `app.ts` — entire page broken |
| CRITICAL | NativePayrollHRValidation | `payrollHRRouter` not imported or mounted in `app.ts` — all Calculate Breakdown and Submit actions fail |
| HIGH | NativeWorkInbox | Route ordering in `inbox.routes.ts`: `/:id/read` declared before `/mark-all-read` — fragile, reorder |
| HIGH | NativePayrollHRValidation | `loadMasterData()` failure swallowed silently — dropdowns empty with no user-visible error |
| MEDIUM | NativeATSFullParityCommandCenter | Run SLA / Repair buttons have no loading state — double-click fires concurrent mutations |
| MEDIUM | NativeATSFullParityCommandCenter | `previewDailyReport()` uses `alert()` for success — inconsistent UX |
| MEDIUM | NativeATSRecruiterWorkspace | History tab date filters rendered as `readOnly` — visible but non-functional |
| LOW | NativeATSRecruiterWorkspace | `loadPending` / `loadHistory` have no individual try/catch — partial failures not distinguishable |
| LOW | ATSCommandCentre | `loadMetrics` / `loadBranches` / `loadRecruiters` have no individual try/catch |
| LOW | NativeWorkInbox | `markAllRead()` has no loading/disabled guard — spam-clickable |

---

## Fixes Required (Ordered by Priority)

1. **`backend/src/modules/ats/ats.routes.ts`** — add `GET /onboarding-bridge` pointing to `c.listOnboardingBridges`.
2. **`backend/src/app.ts`** — mount `commandCentreRouter` at `/api/ats/command-centre`.
3. **`backend/src/app.ts`** — import and mount `payrollHRRouter` at `/api/ats/payroll-hr`.
4. **`backend/src/modules/inbox/inbox.routes.ts`** — move `PATCH /mark-all-read` registration before `PATCH /:id/read`.
5. **`src/pages/NativePayrollHRValidation.tsx`** — surface `loadMasterData` errors in `setError()`.
6. **`src/pages/NativeATSFullParityCommandCenter.tsx`** — add `running` state for Run SLA / Repair buttons; replace `alert()` with inline message.
