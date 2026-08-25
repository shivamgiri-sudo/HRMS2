# Task 11 Brief: New Performance Command Center page (HR/Ops/CEO)

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 11)

## Mandatory design-system consultation (CLAUDE.md rule)

Before writing any JSX, run:
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "hrms leadership dashboard page header" --design-system --stack shadcn -p "MAS PeopleOS"
```
Follow the GradientHeader/GlassCard conventions this HRMS already uses on similar leadership-facing pages.

## Prior task output you depend on

- `PerformanceScorecardTable` (Task 9), default export, props `{ dateFrom, dateTo }`.
- Page code `PERFORMANCE_SCORECARD_COMMAND_CENTER` is already seeded in `page_catalog`/`role_page_access` (Task 8) for the 16-role manager/HR/CEO list (no `admin`/`wfm`) — this task's `Gate pageCode` MUST use this exact string to match.
- `WorkforcePageGate` component, props `{ pageCode: string, children: ReactNode }`, at `src/components/security/WorkforcePageGate.tsx`.

## Task

**Files:**
- Create: `src/pages/PerformanceCommandCenter.tsx`
- Modify: `src/config/routes/performance.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`

**Interfaces:**
- Consumes: `PerformanceScorecardTable`, `WorkforcePageGate`, `useWfmScopeFilter` (from `src/hooks/useWfmScopeFilter.ts`, returns `{ branchIds, processIds, hasAllAccess, isScoped, scopeDescription, isLoading }` — confirm this exact shape by reading the file first).

- [ ] **Step 1: Read reference files first**

Read `src/config/routes/performance.routes.tsx` in full (find the `PIP_MANAGEMENT` route entry and the `Gate` wrapper component defined in that same file, as your structural template) and `src/components/layout/navConfig.tsx`'s Performance section (find the `PIP Management` nav entry as your template). Confirm both still have the shape described in prior research — other sessions may have changed them since.

- [ ] **Step 2: Write the page**

```tsx
// src/pages/PerformanceCommandCenter.tsx
import { useState } from "react";
import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
import { useWfmScopeFilter } from "@/hooks/useWfmScopeFilter";
import { Input } from "@/components/ui/input";

export default function PerformanceCommandCenter() {
  const { scopeDescription } = useWfmScopeFilter();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-6 mb-6">
        <h1 className="text-2xl font-bold">Performance Scorecard</h1>
        <p className="text-white/80 text-sm mt-1">{scopeDescription}</p>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-gray-400">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
      </div>
      <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
    </div>
  );
}
```
Adjust the `useWfmScopeFilter` destructured field name if Step 1 finds it differs from `scopeDescription`. Follow whatever design-system guidance Step 0's mandated search returned for the header treatment if it suggests a more specific pattern than this illustrative gradient.

- [ ] **Step 3: Add the route**

In `src/config/routes/performance.routes.tsx`, add the lazy import near the other lazy imports:
```tsx
const PerformanceCommandCenter = lazy(() => import("@/pages/PerformanceCommandCenter"));
```
And add the route inside the route-elements array, following the exact `PIP_MANAGEMENT` entry's shape (reuse the same `Gate` component already defined in this file):
```tsx
<Route path="/performance-command-center" element={<ProtectedRoute><Gate pageCode="PERFORMANCE_SCORECARD_COMMAND_CENTER"><PerformanceCommandCenter /></Gate></ProtectedRoute>} />
```
Use the EXACT page code string `PERFORMANCE_SCORECARD_COMMAND_CENTER` — this must match Task 8's seeded `page_catalog.page_code` exactly, character for character.

- [ ] **Step 4: Add the nav entry**

In `src/components/layout/navConfig.tsx`, inside the Performance section's `children` array, add (matching the `PIP Management` entry's shape — check what icon import convention `ic(...)` uses and pick a sensible unused lucide icon, e.g. `Gauge` or `LineChart` — confirm it isn't already imported for something else in this file to avoid a duplicate-import error):
```tsx
{ label: "Performance Scorecard", href: "/performance-command-center", icon: ic(Gauge), pageCode: "PERFORMANCE_SCORECARD_COMMAND_CENTER", description: "Full-scope performance scorecard across your team/branch/org" },
```

- [ ] **Step 5: Verify it builds**

Run the real gate: `npm run typecheck` (both halves). Expect zero new errors from the 3 touched/created files.

- [ ] **Step 6: Manual verification (if possible)**

If a dev server / demo login is available, log in as an HR or CEO-tier demo account with the seeded page grant, navigate to `/performance-command-center` via the nav, confirm the page loads and shows rows beyond just the logged-in user's direct team. If not possible in this environment, state that explicitly rather than fabricating a result.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PerformanceCommandCenter.tsx src/config/routes/performance.routes.tsx src/components/layout/navConfig.tsx
git commit -m "feat: add Performance Command Center page for HR/Ops/CEO"
```
Stage only these 3 explicit files. `git status --short` first — `navConfig.tsx` and the routes file are hot, frequently-touched files shared with many other features; if `git status` shows unrelated changes in either, do not stage the whole file, isolate your own lines.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-11-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary (real typecheck result)
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree, especially `navConfig.tsx` and the routes file. `git fetch` + re-check `git log` before committing; isolate your own lines if either file has other unrelated concurrent changes.
- The page code string MUST exactly match Task 8's seed (`PERFORMANCE_SCORECARD_COMMAND_CENTER`) — a typo here means the page gate silently denies everyone (no page_catalog row) or silently allows everyone (falls through to a different default) depending on how `WorkforcePageGate` handles an unknown code; get this exactly right.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
