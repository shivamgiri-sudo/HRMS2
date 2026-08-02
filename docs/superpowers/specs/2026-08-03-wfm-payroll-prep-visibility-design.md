# WFM Payroll Prep Visibility & Guided Workflow — Design Spec
**Date:** 2026-08-03  
**Author:** Architecture session  
**Status:** Approved for implementation

---

## Context

The `/payroll/process-readiness` page and its backend are fully built. WFM staff can mark attendance data ready, request freeze, upload custom deductions, enter overtime, and sign off their process. However three gaps prevent effective use:

1. **Discovery gap** — WFM lands on their WFM Dashboard and has no signal that payroll prep tasks exist. The page is buried under Payroll → Process Readiness in the sidebar.
2. **Guidance gap** — The existing `ProcessDetailDrawer` shows 9 checklist items as a flat toggle list with no sequencing, no inline instructions, no links to the relevant action pages.
3. **Urgency gap** — WFM has no deadline context (days to salary release) and no proactive notification.

**Intended outcome:** A WFM staff member opens their dashboard on any day during the last week of the month, immediately sees which processes need their attention, clicks through to a step-by-step guided flow, completes their checklist, and signs off — without needing to know where the page lives or what each item means.

---

## Scope

Four deliverables, no new pages:

| # | Deliverable | Files touched |
|---|---|---|
| 1 | `PayrollPrepWidget` — new widget on WFM Dashboard | `src/components/dashboard/widgets/PayrollPrepWidget.tsx` (new), `src/pages/dashboards/reference/WfmReferenceLayout.tsx` |
| 2 | Guided stepper — replace flat checklist in `ProcessDetailDrawer` | `src/pages/payroll/ProcessPayrollReadiness.tsx` |
| 3 | Sidebar badge — dynamic pending count on "Process Readiness" nav item | `src/hooks/useNavBadges.ts` (new), `src/components/layout/CompactDashboardLayout.tsx` |
| 4 | Monthly Work Inbox reminder — fires 1st of each month for prior month | `backend/src/workers/payroll-prep-reminder.worker.ts` (new), backend cron registration |

One new lightweight backend endpoint: `GET /api/payroll/process-readiness/my-pending-count`

---

## Architecture

```
[WFM Dashboard]          [Work Inbox]            [Sidebar Nav]
       │                      │                        │
       ▼                      ▼                        ▼
PayrollPrepWidget      "Payroll Prep needed      badge count (N)
useMyPendingProcesses   — [Process Name]"       useNavBadges()
       │                 deep-link to drawer          │
       └──────────────────────┬───────────────────────┘
                              ▼
              /payroll/process-readiness  (existing)
                              │
                              ▼
              ProcessDetailDrawer — GUIDED STEPPER
              (replaces flat checklist inside existing file)
```

**Data flow:**
- `GET /api/payroll/process-readiness/my-pending-count?month=YYYY-MM` returns `{ count: N, processes: [{branch_id, process_id, branch_name, process_name, readiness_score, readiness_status}] }` filtered to the authenticated user's assigned processes that are not yet `ready`.
- Called once on WFM Dashboard load. Result shared via React Query cache — both the widget and the sidebar badge read the same cached response.
- The stepper reads from the existing `GET /api/payroll/process-readiness/:branchId/:processId` — no change.
- Work Inbox items use the existing `createWorkInboxItem` infrastructure via a new worker.

---

## 1. Backend — `my-pending-count` endpoint

**File:** `backend/src/modules/payroll/payroll-process-readiness.routes.ts`

**Route:** `GET /api/payroll/process-readiness/my-pending-count?month=YYYY-MM`

**Roles:** `wfm`, `process_manager`, `branch_head`, `payroll_branch`

**Logic:**
1. Resolve month (default = current month).
2. Look up processes assigned to `req.authUser.id` via `GET /api/process/my-processes` equivalent DB query (join `process_user_assignment` or `process_master` where `wfm_user_id = userId`).
3. For each assigned process, call `payrollBranchReadinessService.getOrRefresh(month, branchId, processId)`.
4. Filter to those where `readiness_status !== 'ready'`.
5. Return `{ success: true, count, processes: [...] }`.

**Register before** `/:branchId/:processId` to avoid Express param collision.

---

## 2. Frontend — `PayrollPrepWidget`

**File:** `src/components/dashboard/widgets/PayrollPrepWidget.tsx` (new)

**Hook:** `useMyPendingProcesses(month)` — wraps `hrmsApi.get('/api/payroll/process-readiness/my-pending-count?month=...')`, queryKey `['wfm-pending-processes', month]`.

**Visual states:**

**Loading:** 3 skeleton rows.

**All ready:**
```
┌────────────────────────────────────────────┐
│ ✓  All processes ready for [Month]         │
│    Payroll Head can now process your data  │
└────────────────────────────────────────────┘
```
Green tinted card, no action needed.

**Pending (N > 0):**
```
┌────────────────────────────────────────────┐
│ 🗓 PAYROLL PREP · August 2026   ● 3 PENDING│
│                                            │
│  NOIDA-2 / Onfido       ████░ 22% Blocked →│
│  NOIDA / Vodafone       ████░ 23% Blocked →│
│  NOIDA-DIALDESK / TCS   ██░░░ 10% Blocked →│
│                                            │
│  [View All →]                              │
└────────────────────────────────────────────┘
```

- Amber/red header with count badge
- Each row: branch name / process name, mini progress bar, status badge, chevron
- Clicking a row navigates to `/payroll/process-readiness` and opens that process's drawer (via URL param `?open=<processId>`)
- "View All" links to `/payroll/process-readiness`

**Placement in `WfmReferenceLayout.tsx`:** Inserted between `<ReferenceHeader>` and the first `<ReferenceMetricGrid>`. Wrapped in `{roleKeys.some(r => ['wfm','process_manager'].includes(r)) && <PayrollPrepWidget month={currentMonth} />}`.

---

## 3. Frontend — Guided Stepper in `ProcessDetailDrawer`

**File:** `src/pages/payroll/ProcessPayrollReadiness.tsx` — replace the checklist section inside `ProcessDetailDrawer`.

### Step definitions (WFM view)

| Step | Title | Owner | Unlock condition |
|------|-------|-------|-----------------|
| 1 | Verify Attendance Data | WFM | Always unlocked |
| 2 | Request Attendance Freeze | WFM | Step 1 complete |
| 3 | Upload Custom Deductions | WFM / PM | Always unlocked (parallel) |
| 4 | Enter Overtime | WFM / PM | Always unlocked (parallel) |
| 5 | Process Sign-Off | PM / Branch Head | Steps 1+2+3+4 complete |

Steps 3 and 4 are independent of each other (can be done in parallel with Step 2 pending). Step 5 requires all prior steps to be checked.

### Step component structure

Each step renders as a `<Collapsible>`:
- **Header:** step number circle (green if done, grey if locked, blue if active) + title + status chip + chevron
- **Body (expanded):**
  - 2–3 sentence plain-English explanation of what to do
  - Relevant action links (e.g., "→ Review attendance exceptions" pointing to the correct page)
  - Timestamp + actor if already completed (e.g., "Done by Ramesh on 28 Jul 14:32")
  - Action button (toggle / confirm / sign-off)

**Auto-collapse:** When a step is marked complete, it collapses and the next pending step auto-expands.

**Step content detail:**

```
Step 1 — Verify Attendance Data  (WFM toggles attendance_data_ready)
  Description: "Confirm all punch logs, regularisations, and 
  attendance exceptions for this process have been reviewed 
  and resolved for the month."
  Links: → Attendance Exceptions, → Mismatch Queue, → Disputes
  Button: [✓ Mark Attendance Data Ready]  (green, always enabled for WFM)
  
Step 2 — Request Attendance Freeze  (WFM sends freeze request via existing API)
  Description: "Signal to the Payroll Head that your attendance 
  data is final. They will freeze it before salary calculation begins. 
  You cannot undo this — ensure Step 1 is complete first."
  Display states:
    • Not requested: [Request Freeze →]  (amber button)
    • Requested / pending: "Freeze requested — awaiting Payroll Head"  (spinner)
    • Frozen: "Frozen on [date] by [name]"  (green, read-only)
  
Step 3 — Upload Custom Deductions  (PM/WFM toggles custom_deductions_uploaded)
  Description: "Upload loan recoveries, salary advances, or penalty 
  deductions for employees in this process via the Payroll module."
  Links: → Payroll → Loan Management, → Custom Deductions
  Button: [✓ Mark Custom Deductions Done]

Step 4 — Enter Overtime  (PM/WFM toggles overtime_entered)
  Description: "Enter approved overtime hours for all eligible 
  employees in this process. Check with the operations team 
  for approved overtime claims."
  Links: → Payroll → Overtime Management
  Button: [✓ Mark Overtime Done]

Step 5 — Process Sign-Off  (PM/Branch Head submits signoff with remarks)
  Description: "Confirm all payroll inputs are complete and correct 
  for this process. This creates a Work Inbox notification for the 
  Payroll Head and unblocks salary calculation."
  Disabled state: "Complete steps 1–4 first"
  Enabled: Shows remarks textarea + [✓ Confirm Sign-Off] button
```

**Read-only info section** (below the stepper, always visible, collapsible by default):
- Bank Details % (from HR — link to employee profiles)
- UAN / PF Complete % (from HR)
- NOC Resolved (from exit module)
- Holiday Work Approved (from WFM holiday work module)

**Role gates:**
- `isWFM = roleKeys.some(r => ['wfm', 'branch_head', 'payroll_branch'].includes(r))`
- `isPM = roleKeys.some(r => ['process_manager', 'branch_head'].includes(r))`
- Step 1 button shown if `isWFM`
- Steps 3 & 4 buttons shown if `isWFM || isPM`
- Step 5 button shown if `isPM || isWFM` (branch_head can also sign off)

---

## 4. Sidebar Badge

**File:** `src/hooks/useNavBadges.ts` (new)

```ts
export function useNavBadges(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ['wfm-pending-processes', currentMonth()],
    queryFn: () => hrmsApi.get('/api/payroll/process-readiness/my-pending-count'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const badges = new Map<string, number>();
  if (data?.count > 0) {
    badges.set('/payroll/process-readiness', data.count);
  }
  return badges;
}
```

**File:** `src/components/layout/CompactDashboardLayout.tsx`

Add `useNavBadges()` call. Create `injectBadges(groups, badges)` utility that deep-clones `filteredGroups` and sets `item.badge = badges.get(item.href)` where matched. Pass injected groups to `SidebarNav`. Only runs the hook when user has wfm/process_manager role to avoid unnecessary API calls for other roles.

---

## 5. Monthly Work Inbox Reminder

**File:** `backend/src/workers/payroll-prep-reminder.worker.ts` (new)

**Trigger:** Runs on the **1st of each month** for the **previous month** (e.g., fires 1 August for July readiness).

**Logic:**
1. Compute `month = previous month as YYYY-MM`.
2. Query `process_master` joined with WFM user assignments to get all `(branchId, processId, userId)` triples for active processes.
3. For each, call `getOrRefresh(month, branchId, processId)`.
4. Filter to those where `readiness_status !== 'ready' && process_manager_signoff === 0`.
5. For each, create a Work Inbox item via `createWorkInboxItem`:
   - **title:** `"Payroll Prep: [Process Name] — [Month] not yet signed off"`
   - **subtitle:** `"[Branch Name] · Score: [N]% · [N] checklist items pending"`
   - **href:** `/payroll/process-readiness?open=[processId]`
   - **assignee:** WFM user ID for that process
   - **priority:** `high` if blocked, `medium` if in_progress

6. Register in `backend/src/workers/index.ts` (or existing cron scheduler).

**URL param handling:** `ProcessPayrollReadiness.tsx` reads `?open=<processId>` on mount. If present, auto-selects that process and opens its drawer.

---

## Deep-link URL param

`/payroll/process-readiness?open=<processId>`

In `ProcessPayrollReadiness.tsx` root component, add:
```ts
const [initialOpen] = useSearchParams();
const autoOpenProcessId = initialOpen.get('open');
```
Pass to each view. When `autoOpenProcessId` matches a loaded process, call `setSelected(proc)` on first render.

---

## Verification

1. **WFM user logs in** → WFM Dashboard shows `PayrollPrepWidget` with pending process count
2. **Sidebar badge** shows red count on "Process Readiness" nav item
3. **Clicking a row** in the widget navigates to `/payroll/process-readiness` and opens the correct process drawer
4. **Stepper is sequential:** Step 2 button is disabled until Step 1 is toggled; Step 5 disabled until 1–4 done
5. **Sign-off creates Work Inbox** item for Payroll Head (existing trigger, unchanged)
6. **Work Inbox reminder** fires on 1st of month: WFM users with incomplete processes get one inbox item per process
7. **Deep-link** `?open=<processId>` auto-opens the correct drawer on load
8. **All-ready state:** widget shows green "all done" card, badge disappears
9. **TypeScript:** `npx tsc --noEmit` passes; `npm run build` succeeds
10. **Role gates:** process_manager sees steps 3–5 active; steps 1–2 read-only if not WFM role