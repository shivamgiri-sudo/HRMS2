# WFM Payroll Prep Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give WFM staff proactive, guided visibility into their monthly payroll prep checklist — a dashboard widget, sidebar badge, step-by-step process drawer, and a monthly Work Inbox reminder.

**Architecture:** A new backend endpoint returns the calling user's pending processes; a React Query hook caches this response and feeds both the WFM Dashboard widget and the sidebar badge; the existing `ProcessDetailDrawer` flat checklist is replaced with a sequential 5-step collapsible stepper; a new cron worker fires on the 1st of each month.

**Tech Stack:** Express + TypeScript (backend), React 18 + TypeScript + Tailwind + shadcn/Radix (frontend), MySQL `mas_hrms`, React Query v5, `react-router-dom` v7.

## Global Constraints

- Backend files live under `backend/src/`; compiled output goes to `backend/dist/`. Run `cd backend && npm run build` to compile.
- Frontend type-check: `npx tsc --noEmit` from repo root.
- All new backend routes must call `requireAuth` then `requireRole(...)`.
- Work Inbox items are created via `createWorkItemIfNotExists` from `backend/src/modules/work-inbox/work-inbox.service.ts`. Its signature: `createWorkItemIfNotExists(input: WorkItemInput): Promise<string>` where `WorkItemInput = { itemType, title, description?, moduleCode, entityType, entityId, assignedToUserId?, assignedToRole?, branchId?, processId?, priority?, dueAt?, createdBy? }`.
- Frontend API calls in `ProcessPayrollReadiness.tsx` use the local `apiFetch(url, opts?)` helper (reads `hrms_token` from `localStorage`). New files use `hrmsApi` from `@/lib/hrmsApi`.
- Workers follow the `start* / stop*` export pattern; register them in `backend/src/workers/all-workers.ts`.
- Sidebar `NavItem` already has a `badge?: number` field; `SidebarNav` already renders it.
- Do NOT modify the existing payroll calculation logic.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/modules/payroll/payroll-process-readiness.routes.ts` | Modify | Add `GET /my-pending-count` endpoint |
| `backend/src/workers/payroll-prep-reminder.worker.ts` | Create | Monthly cron: send Work Inbox items on 1st of month |
| `backend/src/workers/all-workers.ts` | Modify | Register the new worker |
| `src/hooks/useNavBadges.ts` | Create | React Query hook returning `Map<href, count>` |
| `src/components/layout/CompactDashboardLayout.tsx` | Modify | Inject dynamic badge counts into nav groups |
| `src/components/dashboard/widgets/PayrollPrepWidget.tsx` | Create | Dashboard widget showing pending processes |
| `src/pages/dashboards/reference/WfmReferenceLayout.tsx` | Modify | Insert `PayrollPrepWidget` below header |
| `src/pages/payroll/ProcessPayrollReadiness.tsx` | Modify | Replace flat checklist with guided stepper; add URL `?open=` deep-link |

---

### Task 1: Backend — `GET /my-pending-count` endpoint

**Files:**
- Modify: `backend/src/modules/payroll/payroll-process-readiness.routes.ts`

**Interfaces:**
- Produces: `GET /api/payroll/process-readiness/my-pending-count?month=YYYY-MM`
  Response: `{ success: true, count: number, processes: Array<{ branch_id: string; process_id: string; branch_name: string; process_name: string; readiness_score: number; readiness_status: string }> }`

- [ ] **Step 1: Open the routes file and locate the first route registration**

Open `backend/src/modules/payroll/payroll-process-readiness.routes.ts`. The file starts with `payrollProcessReadinessRouter.get("/grouped-summary", ...)`. We must register our new route BEFORE the `/:branchId/:processId` catch-all.

- [ ] **Step 2: Add the endpoint after the `/export` route (around line 145) and before the `/branch/:branchId` route**

Insert this block after the closing `);` of the `/export` route and before the `/branch/:branchId` route:

```typescript
// ---------------------------------------------------------------------------
// GET /my-pending-count?month=YYYY-MM
// Returns the calling user's assigned processes that are not yet ready.
// Roles: wfm, process_manager, branch_head, payroll_branch
// Must be registered before /:branchId/:processId to avoid param collision.
// ---------------------------------------------------------------------------
payrollProcessReadinessRouter.get(
  "/my-pending-count",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_branch"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const userId = req.authUser!.id;

      // Find all processes this user is assigned to via user_assignment_scope
      const [scopeRows] = await db.execute<RowDataPacket[]>(
        `SELECT uas.branch_id, uas.process_id
           FROM user_assignment_scope uas
          WHERE uas.user_id = ?
            AND uas.active_status = 1
            AND uas.process_id IS NOT NULL
            AND uas.scope_type IN ('process', 'branch_process')`,
        [userId]
      );

      const scopes = scopeRows as Array<{ branch_id: string; process_id: string }>;

      if (!scopes.length) {
        return res.json({ success: true, count: 0, processes: [] });
      }

      const pending: Array<{
        branch_id: string;
        process_id: string;
        branch_name: string;
        process_name: string;
        readiness_score: number;
        readiness_status: string;
      }> = [];

      for (const scope of scopes) {
        try {
          const rec = await payrollBranchReadinessService.getOrRefresh(
            month,
            scope.branch_id,
            scope.process_id
          );
          if (rec.readiness_status !== "ready") {
            pending.push({
              branch_id: rec.branch_id,
              process_id: rec.process_id,
              branch_name: rec.branch_name,
              process_name: rec.process_name,
              readiness_score: rec.readiness_score,
              readiness_status: rec.readiness_status,
            });
          }
        } catch {
          // skip processes that fail to load
        }
      }

      return res.json({ success: true, count: pending.length, processes: pending });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] GET /my-pending-count error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch pending count" });
    }
  }
);
```

- [ ] **Step 3: Confirm `db` and `RowDataPacket` are already imported**

Check the top of the file — `import { db } from "../../db/mysql.js"` and `import type { RowDataPacket } from "mysql2"` should already be present. If not, add them.

- [ ] **Step 4: Build the backend to verify no TypeScript errors**

```bash
cd backend && npm run build 2>&1 | tail -5
```
Expected: `tsc --noEmitOnError false` completes with no `error TS` lines.

- [ ] **Step 5: Test the endpoint manually**

```bash
# First get a WFM user token (adjust credentials for your local setup)
TOKEN=$(curl -s -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"wfm.user@teammas.in","password":"password"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','FAIL'))")

curl -s "http://localhost:5055/api/payroll/process-readiness/my-pending-count?month=2026-08" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d,indent=2))"
```
Expected: `{ "success": true, "count": N, "processes": [...] }` — count may be 0 if no scope rows exist.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/payroll-process-readiness.routes.ts
git commit -m "feat(payroll): add GET /process-readiness/my-pending-count endpoint

Returns pending processes for the calling WFM user by querying
user_assignment_scope for process-scoped assignments, then fetching
readiness status for each. Powers dashboard widget and sidebar badge."
```

---

### Task 2: Backend — Monthly payroll prep reminder worker

**Files:**
- Create: `backend/src/workers/payroll-prep-reminder.worker.ts`
- Modify: `backend/src/workers/all-workers.ts`

**Interfaces:**
- Consumes: `payrollBranchReadinessService.getSummaryForBranch(month, branchId)` from `../modules/payroll/payroll-branch-readiness.service.js`
- Consumes: `createWorkItemIfNotExists` from `../modules/work-inbox/work-inbox.service.js`
- Produces: `startPayrollPrepReminderWorker(): Promise<void>`, `stopPayrollPrepReminderWorker(): void`

- [ ] **Step 1: Create `backend/src/workers/payroll-prep-reminder.worker.ts`**

```typescript
/**
 * Payroll Prep Reminder Worker
 *
 * Fires on the 1st of each month (IST) for the PREVIOUS month.
 * For every WFM / process_manager user whose assigned process is not yet
 * signed off, creates a Work Inbox item as a reminder.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { payrollBranchReadinessService } from "../modules/payroll/payroll-branch-readiness.service.js";
import { createWorkItemIfNotExists } from "../modules/work-inbox/work-inbox.service.js";
import { registerTimer, unregisterTimer } from "./worker-utils.js";

const WORKER_NAME = "payroll-prep-reminder";

let scheduledTimer: NodeJS.Timeout | null = null;

/** Returns YYYY-MM for the previous calendar month in IST. */
function previousMonthIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST offset
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed, so this IS the previous month number
  if (m === 0) {
    return `${y - 1}-12`;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** ms until next 1st of month at 08:00 IST (02:30 UTC). */
function msUntilNext1st(): number {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const nextFirst = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 1, 2, 30, 0, 0)
  );
  // If we're already past this month's 1st 02:30 UTC, target next month
  if (nextFirst.getTime() <= now.getTime()) {
    nextFirst.setUTCMonth(nextFirst.getUTCMonth() + 1);
  }
  return nextFirst.getTime() - now.getTime();
}

async function runReminders(): Promise<void> {
  const month = previousMonthIST();
  console.log(`[${WORKER_NAME}] Sending payroll prep reminders for ${month}...`);

  // Find all WFM / process_manager user → process assignments
  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT uas.user_id, uas.branch_id, uas.process_id
       FROM user_assignment_scope uas
      WHERE uas.active_status = 1
        AND uas.process_id IS NOT NULL
        AND uas.scope_type IN ('process', 'branch_process')
        AND uas.role_key IN ('wfm', 'process_manager', 'branch_head', 'payroll_branch')`
  );

  const scopes = scopeRows as Array<{ user_id: string; branch_id: string; process_id: string }>;

  let sent = 0;
  for (const scope of scopes) {
    try {
      const rec = await payrollBranchReadinessService.getOrRefresh(
        month,
        scope.branch_id,
        scope.process_id
      );

      // Only remind if not signed off and not ready
      if (rec.process_manager_signoff === 1 || rec.readiness_status === "ready") {
        continue;
      }

      const priority = rec.readiness_status === "blocked" ? "high" : "medium";
      const pendingItems = [
        !rec.attendance_data_ready && "Attendance not declared",
        !rec.attendance_frozen && "Attendance not frozen",
        !rec.custom_deductions_uploaded && "Custom deductions pending",
        !rec.overtime_entered && "Overtime not entered",
      ]
        .filter(Boolean)
        .join("; ");

      await createWorkItemIfNotExists({
        itemType: "PAYROLL_PREP_REMINDER",
        title: `Payroll Prep: ${rec.process_name} — ${month} sign-off pending`,
        description: pendingItems
          ? `${rec.branch_name} · Score: ${rec.readiness_score}% · Pending: ${pendingItems}`
          : `${rec.branch_name} · Score: ${rec.readiness_score}% · Please review and sign off.`,
        moduleCode: "payroll",
        entityType: "process",
        entityId: scope.process_id,
        assignedToUserId: scope.user_id,
        branchId: scope.branch_id,
        processId: scope.process_id,
        priority,
        // Action URL deep-links into the process readiness drawer
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${WORKER_NAME}] Failed for user ${scope.user_id} / process ${scope.process_id}: ${msg}`);
    }
  }

  console.log(`[${WORKER_NAME}] Sent ${sent} reminder(s) for ${month}.`);
}

export async function startPayrollPrepReminderWorker(): Promise<void> {
  const delay = msUntilNext1st();
  console.log(
    `[${WORKER_NAME}] Next run on 1st of month — in ${Math.round(delay / 3600000)}h`
  );

  scheduledTimer = setTimeout(async () => {
    try {
      await runReminders();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${WORKER_NAME}] Error:`, msg);
    }
    // Reschedule for next month
    await startPayrollPrepReminderWorker();
  }, delay);

  registerTimer(`${WORKER_NAME}-scheduled`, scheduledTimer);
}

export function stopPayrollPrepReminderWorker(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    unregisterTimer(`${WORKER_NAME}-scheduled`);
    scheduledTimer = null;
  }
}
```

- [ ] **Step 2: Register the worker in `backend/src/workers/all-workers.ts`**

Add the import at the top of the imports block (after the last existing import line before `const WORKERS`):

```typescript
import { startPayrollPrepReminderWorker, stopPayrollPrepReminderWorker } from "./payroll-prep-reminder.worker.js";
```

Add an entry to the `WORKERS` array (find `const WORKERS: Array<...> = [` and add before the closing `]`):

```typescript
  {
    name: "payroll-prep-reminder",
    start: startPayrollPrepReminderWorker,
    stop: stopPayrollPrepReminderWorker,
  },
```

- [ ] **Step 3: Check that `WORKERS` array entries have both `start` and `stop`**

Look at how other entries are structured (some have `stop`, some don't). If the array type is `{ name: string; start: () => Promise<void>; stop?: () => void }`, your entry is correct as-is.

- [ ] **Step 4: Build backend**

```bash
cd backend && npm run build 2>&1 | tail -5
```
Expected: no `error TS` lines.

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/payroll-prep-reminder.worker.ts backend/src/workers/all-workers.ts
git commit -m "feat(payroll): add monthly payroll prep reminder worker

Fires on 1st of each month for prior month. Queries user_assignment_scope
to find WFM / process_manager users, fetches readiness for each assigned
process, and creates a Work Inbox item for any process not yet signed off."
```

---

### Task 3: Frontend — `useNavBadges` hook + sidebar badge injection

**Files:**
- Create: `src/hooks/useNavBadges.ts`
- Modify: `src/components/layout/CompactDashboardLayout.tsx`

**Interfaces:**
- Produces: `useNavBadges(): Map<string, number>` — returns a Map from nav href to badge count
- Consumes (in layout): `useWorkforceAccess()` from `@/hooks/useUserRole` — already imported in layout

- [ ] **Step 1: Create `src/hooks/useNavBadges.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

function currentIstMonth(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Returns a Map<navHref, badgeCount> for dynamic sidebar badges.
 * Only makes the API call for roles that have pending processes.
 */
export function useNavBadges(): Map<string, number> {
  const { roleKeys } = useWorkforceAccess();

  // Only fetch for roles that can have pending processes
  const shouldFetch = roleKeys.some((r) =>
    ["wfm", "process_manager", "branch_head", "payroll_branch"].includes(r)
  );

  const month = currentIstMonth();

  const { data } = useQuery({
    queryKey: ["wfm-pending-processes", month],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; count: number }>(
        `/api/payroll/process-readiness/my-pending-count?month=${month}`
      ),
    enabled: shouldFetch,
    staleTime: 5 * 60_000,
    retry: false,
    // Don't throw on error — badge is supplementary UI
    throwOnError: false,
  });

  const badges = new Map<string, number>();
  if (data && data.count > 0) {
    badges.set("/payroll/process-readiness", data.count);
  }
  return badges;
}
```

- [ ] **Step 2: Add `injectBadges` utility and badge hook call in `CompactDashboardLayout.tsx`**

Open `src/components/layout/CompactDashboardLayout.tsx`.

After the existing imports, add:
```typescript
import { useNavBadges } from "@/hooks/useNavBadges";
```

After the line `const filteredGroups = useAccessibleNavGroups(navGroups);` (around line 73), add:
```typescript
  const navBadges = useNavBadges();
```

Add this utility function outside the component (before `export function DashboardLayout`):
```typescript
import type { NavGroup } from "@/components/layout/SidebarNav";

function injectBadges(groups: NavGroup[], badges: Map<string, number>): NavGroup[] {
  if (badges.size === 0) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const count = badges.get(item.href);
      if (!count) return item;
      return { ...item, badge: count };
    }),
  }));
}
```

Find the line `const filteredGroups = useAccessibleNavGroups(navGroups);` and change the two lines that pass `filteredGroups` to `SidebarNav` to use the injected version. Find all occurrences of `groups={filteredGroups}` (there are two — in `SidebarContent` and in the mobile drawer) and change both to:

```typescript
groups={injectBadges(filteredGroups, navBadges)}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "useNavBadges\|injectBadges\|NavGroup"
```
Expected: no output (no errors).

- [ ] **Step 4: Run frontend build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```
Expected: `✓ built in ...`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNavBadges.ts src/components/layout/CompactDashboardLayout.tsx
git commit -m "feat(ui): dynamic sidebar badge for WFM pending process count

useNavBadges hook calls /my-pending-count, injectBadges merges counts into
nav groups before SidebarNav renders. Badge only fetched for wfm / process_manager
/ branch_head / payroll_branch roles."
```

---

### Task 4: Frontend — `PayrollPrepWidget` component

**Files:**
- Create: `src/components/dashboard/widgets/PayrollPrepWidget.tsx`

**Interfaces:**
- Props: `{ month: string }` where month is `YYYY-MM`
- Consumes: `useQuery` queryKey `["wfm-pending-processes", month]` — same key as `useNavBadges`, shares React Query cache
- Produces: rendered widget, imported by `WfmReferenceLayout`

- [ ] **Step 1: Create `src/components/dashboard/widgets/PayrollPrepWidget.tsx`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Calendar, ChevronRight, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

interface PendingProcess {
  branch_id: string;
  process_id: string;
  branch_name: string;
  process_name: string;
  readiness_score: number;
  readiness_status: "not_started" | "in_progress" | "blocked";
}

interface PendingCountResponse {
  success: boolean;
  count: number;
  processes: PendingProcess[];
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function PayrollPrepWidget({ month }: { month: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["wfm-pending-processes", month],
    queryFn: () =>
      hrmsApi.get<PendingCountResponse>(
        `/api/payroll/process-readiness/my-pending-count?month=${month}`
      ),
    staleTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 animate-pulse">
        <div className="h-4 w-40 bg-slate-100 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-slate-50 rounded-xl" />
        ))}
      </div>
    );
  }

  // All ready or no data
  if (!data || data.count === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            All processes ready for {monthLabel(month)}
          </p>
          <p className="text-xs text-emerald-600 mt-0.5">
            Payroll Head can now process your data
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-3 border-b border-amber-100">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-600" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
            Payroll Prep · {monthLabel(month)}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
          <AlertTriangle className="h-3 w-3" />
          {data.count} pending
        </span>
      </div>

      {/* Process rows */}
      <div className="divide-y divide-slate-100">
        {data.processes.map((proc) => (
          <Link
            key={proc.process_id}
            to={`/payroll/process-readiness?open=${proc.process_id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 leading-tight truncate">
                {proc.branch_name} / {proc.process_name}
              </p>
              <div className="mt-1 flex items-center gap-2">
                {/* Mini progress bar */}
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 max-w-[80px]">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      proc.readiness_score >= 80
                        ? "bg-emerald-400"
                        : proc.readiness_score >= 50
                        ? "bg-amber-400"
                        : "bg-red-400"
                    )}
                    style={{ width: `${proc.readiness_score}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {proc.readiness_score}%
                </span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold border",
                    proc.readiness_status === "blocked"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : proc.readiness_status === "in_progress"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-50 text-slate-500 border-slate-200"
                  )}
                >
                  {proc.readiness_status.replace("_", " ")}
                </span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
          </Link>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
        <Link
          to="/payroll/process-readiness"
          className="text-xs font-semibold text-blue-600 hover:text-blue-800"
        >
          View all processes →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Insert `PayrollPrepWidget` into `WfmReferenceLayout.tsx`**

Open `src/pages/dashboards/reference/WfmReferenceLayout.tsx`.

Add the import at the top:
```typescript
import { PayrollPrepWidget } from "@/components/dashboard/widgets/PayrollPrepWidget";
```

Inside `WfmReferenceLayout`, add a `currentMonth` helper and insert the widget. The function signature is:
```typescript
export function WfmReferenceLayout({
  data,
  filters,
}: {
  data: ReferenceDashboardData;
  filters: React.ReactNode;
})
```

Add inside the function body, before the `return`:
```typescript
  const currentMonth = (() => {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
```

In the returned JSX, find `<ReferenceHeader ... />` and add the widget immediately after it:
```tsx
      <PayrollPrepWidget month={currentMonth} />
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "PayrollPrepWidget\|WfmReferenceLayout"
```
Expected: no output.

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```
Expected: `✓ built in ...`

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/widgets/PayrollPrepWidget.tsx src/pages/dashboards/reference/WfmReferenceLayout.tsx
git commit -m "feat(ui): PayrollPrepWidget on WFM Dashboard

Shows pending processes with score bars and status badges. Links each row
to /payroll/process-readiness?open=<processId> for direct drawer access.
All-ready state shows a green confirmation card. Shares React Query cache
with the sidebar badge hook."
```

---

### Task 5: Frontend — Guided stepper in `ProcessDetailDrawer` + deep-link URL param

**Files:**
- Modify: `src/pages/payroll/ProcessPayrollReadiness.tsx`

**Interfaces:**
- Consumes (existing): `apiFetch(url, opts?)` local helper — already in file
- Consumes (existing): `ProcessReadiness` type — already in file
- Consumes (existing): `checklistMutation`, `freezeRequestMutation`, `setSignOffOpen` — already in `ProcessDetailDrawer`
- The stepper replaces the `{/* Checklist */}` block inside `ProcessDetailDrawer`. The sign-off button already exists further down and remains unchanged.

- [ ] **Step 1: Add `useSearchParams` import**

At line 1, change:
```typescript
import React, { useState } from "react";
```
to:
```typescript
import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
```

Also add `Link` to the imports from `"react-router-dom"` if not already present. Check with:
```bash
grep "react-router-dom" src/pages/payroll/ProcessPayrollReadiness.tsx
```
If `Link` is missing, add it: `import { Link, useSearchParams } from "react-router-dom";`

- [ ] **Step 2: Add `useSearchParams` to the root component and pass `autoOpenProcessId` to views**

Find the `export default function ProcessPayrollReadiness()` function (around line 993). Add inside it, after `const branchId`:

```typescript
  const [searchParams] = useSearchParams();
  const autoOpenProcessId = searchParams.get("open") ?? undefined;
```

Find each view render: `<HOGroupedView roleKeys={roleKeys} />`, `<BranchProcessView branchId={branchId} roleKeys={roleKeys} />`, `<SingleProcessView userId={user.id} roleKeys={roleKeys} />`.

Add `autoOpenProcessId` prop to each:
```tsx
{isHO && <HOGroupedView roleKeys={roleKeys} autoOpenProcessId={autoOpenProcessId} />}
{isBranchHead && branchId && <BranchProcessView branchId={branchId} roleKeys={roleKeys} autoOpenProcessId={autoOpenProcessId} />}
{isPMorWFM && user?.id && <SingleProcessView userId={user.id} roleKeys={roleKeys} autoOpenProcessId={autoOpenProcessId} />}
```

- [ ] **Step 3: Add `autoOpenProcessId` prop to each view and auto-open logic**

Find `function HOGroupedView({ roleKeys }: { roleKeys: string[] })` and change to:
```typescript
function HOGroupedView({ roleKeys, autoOpenProcessId }: { roleKeys: string[]; autoOpenProcessId?: string })
```
Inside, after `const [selected, setSelected] = useState<ProcessReadiness | null>(null);`, add:
```typescript
  // Auto-open a specific process if deep-linked via ?open=<processId>
  useEffect(() => {
    if (!autoOpenProcessId || !groups.length) return;
    for (const group of groups) {
      const proc = group.processes.find((p) => p.process_id === autoOpenProcessId);
      if (proc) { setSelected(proc); break; }
    }
  }, [autoOpenProcessId, groups]);
```

Do the same for `BranchProcessView` and `SingleProcessView`, but searching their `processes` array instead of `groups`.

- [ ] **Step 4: Replace the flat checklist block in `ProcessDetailDrawer` with a guided stepper**

Find the `{/* Checklist */}` block inside `ProcessDetailDrawer` (around line 360). Replace the entire block from `<div className="rounded-lg border p-3 space-y-0.5">` through its closing `</div>` with the new stepper:

```tsx
          {/* ── Guided Stepper ── */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Payroll Prep Steps
            </p>

            {/* Step 1 — Verify Attendance Data */}
            <StepItem
              number={1}
              title="Verify Attendance Data"
              done={process.attendance_data_ready === 1}
              locked={false}
              doneAt={process.attendance_data_ready_at}
              doneBy={process.attendance_data_ready_by}
            >
              <p className="text-xs text-slate-500">
                Confirm all punch logs, regularisations, and attendance exceptions for this process
                have been reviewed and resolved for the month.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Link to="/wfm/attendance-exceptions" className="text-xs font-medium text-blue-600 hover:underline">
                  → Attendance Exceptions
                </Link>
                <Link to="/wfm/mismatch-queue" className="text-xs font-medium text-blue-600 hover:underline">
                  → Mismatch Queue
                </Link>
                <Link to="/attendance/disputes" className="text-xs font-medium text-blue-600 hover:underline">
                  → Disputes
                </Link>
              </div>
              {canToggleAttendance && process.attendance_data_ready === 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "attendance_data_ready", value: 1 })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Attendance Data Ready
                </Button>
              )}
              {canToggleAttendance && process.attendance_data_ready === 1 && (
                <button
                  type="button"
                  className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "attendance_data_ready", value: 0 })}
                >
                  Undo
                </button>
              )}
            </StepItem>

            {/* Step 2 — Request Attendance Freeze */}
            <StepItem
              number={2}
              title="Request Attendance Freeze"
              done={process.attendance_frozen === 1}
              locked={process.attendance_data_ready === 0}
            >
              <p className="text-xs text-slate-500">
                Signal to the Payroll Head that your attendance data is final. They will freeze it
                before salary calculation begins. Ensure Step 1 is complete first.
              </p>
              {process.attendance_frozen === 1 ? (
                <p className="mt-2 text-xs text-emerald-700 font-medium">
                  ✓ Frozen{process.attendance_frozen_at ? ` on ${fmtDate(process.attendance_frozen_at)}` : ""}
                </p>
              ) : isWFM ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full border-amber-300 text-amber-800 hover:bg-amber-50"
                  disabled={freezeRequestMutation.isPending || process.attendance_data_ready === 0}
                  onClick={() => freezeRequestMutation.mutate()}
                >
                  <Bell className="h-3.5 w-3.5 mr-1.5" />
                  {freezeRequestMutation.isPending ? "Requesting…" : "Request Attendance Freeze"}
                </Button>
              ) : (
                <p className="mt-2 text-xs text-slate-400 italic">
                  Awaiting Payroll Head to freeze attendance
                </p>
              )}
            </StepItem>

            {/* Step 3 — Custom Deductions */}
            <StepItem
              number={3}
              title="Upload Custom Deductions"
              done={process.custom_deductions_uploaded === 1}
              locked={false}
              doneAt={process.custom_deductions_confirmed_at}
            >
              <p className="text-xs text-slate-500">
                Upload loan recoveries, salary advances, or penalty deductions for employees in
                this process via the Payroll module.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Link to="/payroll/loans" className="text-xs font-medium text-blue-600 hover:underline">
                  → Loan Management
                </Link>
                <Link to="/payroll" className="text-xs font-medium text-blue-600 hover:underline">
                  → Payroll Module
                </Link>
              </div>
              {canToggleOther && process.custom_deductions_uploaded === 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "custom_deductions_uploaded", value: 1 })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Custom Deductions Done
                </Button>
              )}
              {canToggleOther && process.custom_deductions_uploaded === 1 && (
                <button
                  type="button"
                  className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "custom_deductions_uploaded", value: 0 })}
                >
                  Undo
                </button>
              )}
            </StepItem>

            {/* Step 4 — Overtime */}
            <StepItem
              number={4}
              title="Enter Overtime"
              done={process.overtime_entered === 1}
              locked={false}
              doneAt={process.overtime_confirmed_at}
            >
              <p className="text-xs text-slate-500">
                Enter approved overtime hours for all eligible employees in this process. Check
                with the operations team for approved overtime claims.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Link to="/payroll/overtime" className="text-xs font-medium text-blue-600 hover:underline">
                  → Overtime Management
                </Link>
              </div>
              {canToggleOther && process.overtime_entered === 0 && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "overtime_entered", value: 1 })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Overtime Done
                </Button>
              )}
              {canToggleOther && process.overtime_entered === 1 && (
                <button
                  type="button"
                  className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                  disabled={checklistMutation.isPending}
                  onClick={() => checklistMutation.mutate({ item: "overtime_entered", value: 0 })}
                >
                  Undo
                </button>
              )}
            </StepItem>

            {/* Step 5 — Sign Off (moved from existing actions section) */}
            <StepItem
              number={5}
              title="Process Sign-Off"
              done={process.process_manager_signoff === 1}
              locked={
                process.attendance_data_ready === 0 ||
                process.attendance_frozen === 0 ||
                process.custom_deductions_uploaded === 0 ||
                process.overtime_entered === 0
              }
              doneAt={process.process_manager_signoff_at}
              doneBy={process.process_manager_signoff_by}
            >
              <p className="text-xs text-slate-500">
                Confirm all payroll inputs are complete and correct. This notifies the Payroll Head
                and unblocks salary calculation.
              </p>
              {process.process_manager_signoff === 0 && canSignOff && (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setSignOffOpen(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Confirm Sign-Off
                </Button>
              )}
              {process.process_manager_signoff === 0 && !canSignOff && (canToggleAttendance || canToggleOther) && (
                <p className="mt-2 text-xs text-slate-400 italic">
                  Complete steps 1–4 first to enable sign-off
                </p>
              )}
              {process.process_manager_remarks && (
                <p className="mt-2 text-xs text-slate-500 italic">
                  "{process.process_manager_remarks}"
                </p>
              )}
            </StepItem>
          </div>

          {/* ── Read-only info (HR-managed) ── */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 mt-1">
                <Info className="h-3.5 w-3.5" />
                HR-managed checklist items
                <ChevronDown className="h-3 w-3" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-lg border bg-slate-50 p-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Bank Details Complete</span>
                  <span className={process.bank_details_pct >= 95 ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                    {process.bank_details_pct}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">UAN / PF Complete</span>
                  <span className={process.uan_complete_pct >= 95 ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                    {process.uan_complete_pct}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">NOC Resolved</span>
                  <span className={process.noc_resolved ? "text-emerald-600" : "text-red-500"}>
                    {process.noc_resolved ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Holiday Work Approved</span>
                  <span className={process.holiday_work_approved ? "text-emerald-600" : "text-red-500"}>
                    {process.holiday_work_approved ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
```

- [ ] **Step 5: Add the `StepItem` sub-component above `ProcessDetailDrawer`**

Insert this function before the `ProcessDetailDrawer` function definition:

```typescript
function StepItem({
  number,
  title,
  done,
  locked,
  doneAt,
  doneBy,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  locked: boolean;
  doneAt?: string | null;
  doneBy?: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!done && !locked);

  // Auto-expand when step becomes active
  useEffect(() => {
    if (!done && !locked) setOpen(true);
    if (done) setOpen(false);
  }, [done, locked]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
            done
              ? "bg-emerald-50 border border-emerald-200"
              : locked
              ? "bg-slate-50 border border-slate-200 opacity-60"
              : "bg-white border border-blue-200 shadow-sm"
          )}
          disabled={locked}
        >
          <span
            className={cn(
              "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
              done
                ? "bg-emerald-500 text-white"
                : locked
                ? "bg-slate-200 text-slate-400"
                : "bg-blue-500 text-white"
            )}
          >
            {done ? <CheckCircle2 className="h-4 w-4" /> : number}
          </span>
          <div className="flex-1 min-w-0">
            <span className={cn("text-sm font-semibold", done ? "text-emerald-700" : locked ? "text-slate-400" : "text-slate-800")}>
              {title}
            </span>
            {done && doneAt && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                Done{doneBy ? ` by ${doneBy}` : ""} · {fmtDate(doneAt)}
              </p>
            )}
            {locked && <p className="text-[10px] text-slate-400 mt-0.5">Complete previous steps first</p>}
          </div>
          <ChevronDown className={cn("h-4 w-4 flex-shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pt-2 pb-3 border border-t-0 border-slate-200 rounded-b-xl bg-white">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 6: Add missing imports to `ProcessPayrollReadiness.tsx`**

Check that `Bell`, `Info`, `ChevronDown`, `Link` are imported. The file already imports `CheckCircle2`, `XCircle`, `AlertCircle`, `Clock`, `ChevronDown`, `ChevronRight`, `RefreshCw`, `Download`, `Bell`, `Layers`, `Building2`, `Info`. Confirm `Link` from `react-router-dom` is imported — if not, add it.

Also verify `cn` is imported: `import { cn } from "@/lib/utils";` — add if not present.

- [ ] **Step 7: Also add `custom_deductions_confirmed_at` and `overtime_confirmed_at` to the `ProcessReadiness` type**

Find the `interface ProcessReadiness` block (around line 36) and add:
```typescript
  custom_deductions_confirmed_at: string | null;
  overtime_confirmed_at: string | null;
```

- [ ] **Step 8: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "ProcessPayrollReadiness\|StepItem\|autoOpenProcessId" | head -10
```
Expected: no errors.

- [ ] **Step 9: Build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```
Expected: `✓ built in ...`

- [ ] **Step 10: Commit**

```bash
git add src/pages/payroll/ProcessPayrollReadiness.tsx
git commit -m "feat(payroll): guided 5-step stepper in ProcessDetailDrawer + deep-link

Replaces flat 9-item checklist with sequential StepItem collapsibles:
1 Verify Attendance (WFM), 2 Request Freeze (WFM), 3 Custom Deductions,
4 Overtime, 5 Sign-Off (unlocks when 1-4 done). Each step has inline
instructions, action links, and toggle/confirm buttons. HR-managed items
(bank %, UAN %, NOC, holiday work) shown in a collapsible read-only section.
URL ?open=<processId> auto-opens the correct process drawer on load."
```

---

### Task 6: Push and deploy

- [ ] **Step 1: Final type check**

```bash
npx tsc --noEmit 2>&1 && echo "TS OK"
cd backend && npx tsc --noEmit false 2>&1 | grep -c "error TS" && cd ..
```
Expected: `TS OK` and `0` errors.

- [ ] **Step 2: Final build**

```bash
npm run build 2>&1 | grep -E "✓ built|error"
```

- [ ] **Step 3: Push to GitHub**

```bash
git fetch origin
git rebase origin/main 2>/dev/null || git merge origin/main --no-edit
git push origin main
```

- [ ] **Step 4: Deploy to production**

```bash
plink -ssh -pw "$MAS_SERVER_PASSWORD" masadmin@<mcn_lms host — see backend/.env> \
  "cd /var/www/HRMS2 && git pull origin main && \
   cd backend && npm run build && cd .. && npm run build && \
   fuser -k 5055/tcp 2>/dev/null; sleep 2; \
   pm2 delete hrms2-backend 2>/dev/null; \
   pm2 start /var/www/HRMS2/backend/dist/src/server.js \
     --name hrms2-backend \
     --cwd /var/www/HRMS2/backend \
     --log /var/www/HRMS2/backend/logs/backend-out.log \
     --error /var/www/HRMS2/backend/logs/backend-err.log && \
   pm2 save && sleep 6 && curl -s http://localhost:5055/api/health"
```
Expected: `{"status":"healthy",...}` or `{"status":"degraded",...}` (degraded = pre-existing LMS worker errors, API is functional).

---

## Self-Review Checklist

**Spec coverage:**
- ✓ Task 1: `GET /my-pending-count` endpoint
- ✓ Task 2: Monthly Work Inbox reminder worker (fires 1st of month for prior month)
- ✓ Task 3: Sidebar badge via `useNavBadges` + `injectBadges`
- ✓ Task 4: `PayrollPrepWidget` on WFM Dashboard
- ✓ Task 5: Guided stepper (5 steps) + deep-link `?open=<processId>`
- ✓ All role gates: `isWFM`, `isPM`, `canToggleAttendance`, `canToggleOther`, `canSignOff`
- ✓ Read-only HR info section (collapsible)
- ✓ Auto-expand logic in `StepItem`

**Placeholder scan:** No TBDs or vague steps. Every step has concrete code.

**Type consistency:**
- `autoOpenProcessId: string | undefined` passed to all three views, used in `useEffect`
- `StepItem` props: `number, title, done, locked, doneAt?, doneBy?, children` — used consistently
- `injectBadges(groups: NavGroup[], badges: Map<string, number>): NavGroup[]` — `NavGroup` imported from `@/components/layout/SidebarNav`