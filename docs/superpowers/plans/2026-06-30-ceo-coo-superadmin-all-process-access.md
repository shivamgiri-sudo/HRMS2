# CEO / COO / Super Admin — Full Org Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Super Admin, CEO, and the new COO role have unrestricted access to all process/branch data across every dashboard — Quality, Operations, KPI, Attendance, Leave, Headcount — with a process-name display (never raw codes), and that their existing pages show org-wide data by default without needing to manually select a process.

**Architecture:** Three tracks running in parallel: (1) Add `coo` role to the database, middleware alias map, and JWT resolution so it behaves identically to `ceo` for all data access; (2) Fix every existing scoped utility (`resolveDashboardScope`, `resolveDashboardScope` in the prior plan) to treat `super_admin`, `ceo`, and `coo` as unconditional global = true; (3) Wire the already-built `quality-executive.service.ts` to a real API endpoint and update the CEO dashboard + existing Executive Quality page to consume it — showing all processes in one view with no mandatory selector.

**Tech Stack:** Express + TypeScript + MySQL (backend); React 18 + TypeScript + React Query (frontend); existing `requireRole`, `resolveDashboardScope`, `quality-executive.service.ts`, `dashboard-metric.service.ts`, `CeoDashboard.tsx`, `ExecutiveQualityDashboard.tsx`, `SuperAdminDashboardV2.tsx`.

---

## Context

### What already exists (reuse these)
| Asset | Location | Status |
|---|---|---|
| `quality-executive.service.ts` | `backend/src/modules/quality-dashboard/` | **Built but no HTTP endpoint wired** |
| `CeoDashboard.tsx` | `src/pages/dashboards/` | Exists, gated to `ceo` + `super_admin`, but calls only headcount/payroll metrics — no quality/KPI/operations |
| `ExecutiveQualityDashboard.tsx` | `src/pages/` | Exists, calls `/api/executive/quality-summary` but that route doesn't exist yet |
| `SuperAdminDashboardV2.tsx` | `src/pages/` | Exists, system-level only (user count, module health) — no business metrics |
| `ManagementDashboard.tsx` | `src/pages/` | Tabbed: team overview, agent perf, payroll, training — single-process scoped |
| `resolveDashboardScope.ts` | `backend/src/shared/` | Built in prior plan — `GLOBAL_ROLES` set already contains `ceo`, `super_admin` |
| `operations-live.service.ts` | `backend/src/modules/operations/` | Supports all-process mode when no filter passed |
| `kpi.service.ts` | `backend/src/modules/kpi/` | Has `getLeaderboard()` — needs org-wide variant |
| `dashboard-metric.service.ts` | `backend/src/modules/dashboards/` | Has `getHeadcountMetrics()` etc. — needs "no filter" org mode |
| Role definitions | `backend/sql/003_access_control.sql` | No `coo` role yet |
| `navConfig.tsx` | `src/components/layout/` | Has CEO/admin nav items — needs COO added |

### What is missing / broken
1. **COO role doesn't exist** — no DB row, no middleware alias, no page access.
2. **`/api/executive/quality-summary` endpoint is missing** — `ExecutiveQualityDashboard.tsx` calls it but it isn't wired.
3. **CEO Dashboard has no quality/KPI/ops data** — only shows headcount/payroll metrics.
4. **`Super Admin Dashboard` is system-level only** — no business process metrics at all.
5. **`resolveDashboardScope`** (prior plan) already has `ceo`/`super_admin` in `GLOBAL_ROLES` — but `coo` is not in it yet.
6. **KPI module has no org-wide summary** — always requires a `processId` parameter.
7. **Navigation** does not show COO in role-gated items.

---

## File Structure

### Backend — new/modified
```
backend/src/db/migrations/
  20260630_coo_role.sql                     ← NEW: INSERT coo role + page access grants

backend/src/shared/
  resolveDashboardScope.ts                  ← MODIFY: add 'coo' to GLOBAL_ROLES set

backend/src/middleware/
  requireRole.ts                            ← MODIFY: add 'coo' alias (coo ↔ ceo for scoping)

backend/src/modules/quality-dashboard/
  quality-executive.routes.ts               ← NEW: wires quality-executive.service.ts to HTTP
  quality-dashboard.routes.ts               ← MODIFY: mount executive routes

backend/src/modules/kpi/
  kpi-org-summary.service.ts                ← NEW: org-wide KPI aggregate (all processes)
  kpi.routes.ts                             ← MODIFY: add /org-summary endpoint

backend/src/modules/dashboards/
  dashboard.routes.ts                       ← MODIFY: ensure CEO_DASHBOARD scope = ORG_ALL for coo

backend/src/app.ts                          ← MODIFY: mount quality-executive.routes
```

### Frontend — new/modified
```
src/pages/dashboards/
  CeoDashboard.tsx                          ← MODIFY: add quality score panel + ops panel

src/pages/
  ExecutiveQualityDashboard.tsx             ← MODIFY: add role guard (ceo, coo, super_admin)
  SuperAdminDashboardV2.tsx                 ← MODIFY: add cross-process business metric tab

src/hooks/
  useProcessScopedDefaults.ts               ← MODIFY (prior plan): add 'coo' to GLOBAL_ROLE_KEYS
  useExecutiveQuality.ts                    ← NEW: React Query hook for executive quality data
  useOrgKpiSummary.ts                       ← NEW: React Query hook for org-wide KPI

src/components/layout/
  navConfig.tsx                             ← MODIFY: add 'coo' to all role arrays that include 'ceo'
```

---

## Task 1: Add COO Role to Database

**Files:**
- Create: `backend/src/db/migrations/20260630_coo_role.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 20260630_coo_role.sql
-- Adds COO (Chief Operating Officer) role to HRMS.
-- COO has identical data access to CEO: global read across all processes/branches.
-- Additive migration — safe to apply on live schema.

-- 1. Insert role definition
INSERT IGNORE INTO roles (role_key, role_name, description, is_system_role, created_at)
VALUES ('coo', 'COO', 'Chief Operating Officer — org-wide read access to all process/branch data', 1, NOW());

-- 2. Copy all page access grants from CEO role to COO
INSERT IGNORE INTO role_page_access (role_key, page_code, can_view, can_edit, can_export, created_at)
SELECT 'coo', page_code, can_view, can_edit, can_export, NOW()
FROM role_page_access
WHERE role_key = 'ceo';

-- 3. Copy dashboard access grants from CEO to COO
INSERT IGNORE INTO role_dashboard_access (role_key, dashboard_code, can_view, can_export, created_at)
SELECT 'coo', dashboard_code, can_view, can_export, NOW()
FROM role_dashboard_access
WHERE role_key = 'ceo';

-- 4. Verify: SELECT role_key, role_name FROM roles WHERE role_key IN ('ceo','coo','super_admin');
```

- [ ] **Step 2: Verify the file**

```bash
ls "backend/src/db/migrations/20260630_coo_role.sql"
# Do NOT run this SQL against production without explicit user approval.
# Run only against isolated staging: mysql -u root -p mas_hrms_staging < ...
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/migrations/20260630_coo_role.sql
git commit -m "feat(roles): add COO role with same page/dashboard access as CEO"
```

---

## Task 2: Add COO to Backend Role Middleware and Scope Utilities

**Files:**
- Modify: `backend/src/middleware/requireRole.ts`
- Modify: `backend/src/shared/resolveDashboardScope.ts`

- [ ] **Step 1: Read requireRole.ts to see existing alias map**

```bash
grep -n "alias\|process_manager\|team_leader\|manager\|ceo" "backend/src/middleware/requireRole.ts"
```
Expected: See a map like `{ process_manager: 'manager', team_leader: 'tl' }`.

- [ ] **Step 2: Add 'coo' alias in requireRole.ts**

Find the alias map (it will look like):
```typescript
const ROLE_ALIASES: Record<string, string> = {
  process_manager: 'manager',
  team_leader: 'tl',
};
```

Add `coo` as an alias for `ceo` so any route that permits `ceo` also permits `coo`:
```typescript
const ROLE_ALIASES: Record<string, string> = {
  process_manager: 'manager',
  team_leader: 'tl',
  coo: 'ceo',              // COO has identical access level to CEO
};
```

- [ ] **Step 3: Add 'coo' to GLOBAL_ROLES in resolveDashboardScope.ts**

Find:
```typescript
const GLOBAL_ROLES = new Set([
  'super_admin', 'admin', 'hr', 'hr_admin', 'ceo', 'qa', 'qa_manager', 'analyst',
  'finance', 'finance_admin', 'compliance',
]);
```

Change to:
```typescript
const GLOBAL_ROLES = new Set([
  'super_admin', 'admin', 'hr', 'hr_admin', 'ceo', 'coo', 'qa', 'qa_manager', 'analyst',
  'finance', 'finance_admin', 'compliance',
]);
```

- [ ] **Step 4: Compile backend**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/requireRole.ts \
        backend/src/shared/resolveDashboardScope.ts
git commit -m "feat(roles): add coo role alias (ceo-equivalent) to requireRole and resolveDashboardScope"
```

---

## Task 3: Wire Quality Executive Service to HTTP Endpoint

**Why:** `quality-executive.service.ts` is fully built but has no route. `ExecutiveQualityDashboard.tsx` calls `/api/executive/quality-summary` which returns 404.

**Files:**
- Create: `backend/src/modules/quality-dashboard/quality-executive.routes.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Read quality-executive.service.ts to understand its exported functions**

```bash
grep -n "^export async function\|^export function\|module.exports" "backend/src/modules/quality-dashboard/quality-executive.service.ts" | head -20
```
Expected: See functions like `getExecutiveQualitySummary(daysBack: number)` or similar.

- [ ] **Step 2: Read first 60 lines of the service to understand the return shape**

```bash
head -60 "backend/src/modules/quality-dashboard/quality-executive.service.ts"
```
Expected: See return type with `orgKpi`, `trends`, `topPerformers`, `bottomPerformers`, `processScorecard`, `riskSummary`, `benchmarks`.

- [ ] **Step 3: Create the routes file**

```typescript
// backend/src/modules/quality-dashboard/quality-executive.routes.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';   // adjust to actual import
import { requireRole } from '../../middleware/requireRole';

// Import the actual function name found in Step 1 — adjust if different
import { getExecutiveQualitySummary } from './quality-executive.service';

const router = Router();

router.use(requireAuth);

// GET /api/executive/quality-summary?daysBack=30
// Access: super_admin, ceo, coo, admin (coo resolves to ceo via alias in requireRole)
router.get(
  '/quality-summary',
  requireRole(['super_admin', 'admin', 'ceo', 'coo']),
  async (req: Request, res: Response) => {
    const daysBack = parseInt((req.query.daysBack as string) ?? '30', 10);
    const safeDays = isNaN(daysBack) || daysBack < 1 ? 30 : Math.min(daysBack, 365);
    
    try {
      const data = await getExecutiveQualitySummary(safeDays);
      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to load executive quality summary' });
    }
  }
);

// GET /api/executive/quality-summary/process-breakdown?daysBack=30
// Returns per-process quality scorecard for the process comparison table
router.get(
  '/quality-summary/process-breakdown',
  requireRole(['super_admin', 'admin', 'ceo', 'coo']),
  async (req: Request, res: Response) => {
    const daysBack = parseInt((req.query.daysBack as string) ?? '30', 10);
    const safeDays = isNaN(daysBack) || daysBack < 1 ? 30 : Math.min(daysBack, 365);
    
    try {
      const full = await getExecutiveQualitySummary(safeDays);
      // Return just the process scorecard portion for drilldown use
      return res.json({ success: true, data: full.processScorecard ?? [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to load process breakdown' });
    }
  }
);

export default router;
```

- [ ] **Step 4: Mount the router in app.ts**

Find the block where existing quality-dashboard routes are mounted (search for `quality-dashboard` in `backend/src/app.ts`). Add after:

```typescript
import executiveQualityRouter from './modules/quality-dashboard/quality-executive.routes';

// In the route mounting section:
app.use('/api/executive', executiveQualityRouter);
```

- [ ] **Step 5: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/quality-dashboard/quality-executive.routes.ts \
        backend/src/app.ts
git commit -m "feat(executive): wire quality-executive.service to /api/executive/quality-summary endpoint"
```

---

## Task 4: Build Org-Wide KPI Summary Endpoint

**Why:** CEO/COO need to see KPI performance across all processes. `kpi.service.ts` only supports single-process queries.

**Files:**
- Create: `backend/src/modules/kpi/kpi-org-summary.service.ts`
- Modify: `backend/src/modules/kpi/kpi.routes.ts`

- [ ] **Step 1: Write the org KPI summary service**

```typescript
// backend/src/modules/kpi/kpi-org-summary.service.ts
import db from '../../db'; // adjust to actual db import

export interface ProcessKpiSummary {
  processId: string;
  processName: string;
  branchName: string;
  agentCount: number;
  avgScore: number;
  topScore: number;
  bottomScore: number;
  sRating: number;   // count of S-band agents (score >= 100%)
  aRating: number;   // A-band (>= 90%)
  bRating: number;   // B-band (>= 75%)
  cRating: number;   // C-band (>= 60%)
  dRating: number;   // D-band (< 60%)
}

export interface OrgKpiSummary {
  orgAvgScore: number;
  totalAgentsScored: number;
  periodLabel: string;
  processSummaries: ProcessKpiSummary[];
  topProcess: { processName: string; avgScore: number } | null;
  bottomProcess: { processName: string; avgScore: number } | null;
}

export async function getOrgKpiSummary(periodDate: string): Promise<OrgKpiSummary> {
  // periodDate = YYYY-MM (e.g. "2026-06")
  const yearMonth = periodDate.length === 7 ? periodDate : periodDate.substring(0, 7);

  const [rows] = await db.execute<any[]>(
    `SELECT
       pm.id          AS process_id,
       pm.process_name,
       b.branch_name,
       COUNT(DISTINCT ks.employee_id)                  AS agent_count,
       ROUND(AVG(ks.score), 2)                         AS avg_score,
       ROUND(MAX(ks.score), 2)                         AS top_score,
       ROUND(MIN(ks.score), 2)                         AS bottom_score,
       SUM(CASE WHEN ks.score >= 100 THEN 1 ELSE 0 END) AS s_rating,
       SUM(CASE WHEN ks.score >= 90 AND ks.score < 100 THEN 1 ELSE 0 END) AS a_rating,
       SUM(CASE WHEN ks.score >= 75 AND ks.score < 90  THEN 1 ELSE 0 END) AS b_rating,
       SUM(CASE WHEN ks.score >= 60 AND ks.score < 75  THEN 1 ELSE 0 END) AS c_rating,
       SUM(CASE WHEN ks.score < 60 THEN 1 ELSE 0 END)  AS d_rating
     FROM kpi_scores ks
     JOIN employees e  ON e.id = ks.employee_id AND e.active_status = 1
     JOIN process_master pm ON pm.id = e.process_id AND pm.active_status = 1
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE DATE_FORMAT(ks.period_date, '%Y-%m') = ?
     GROUP BY pm.id, pm.process_name, b.branch_name
     ORDER BY avg_score DESC`,
    [yearMonth]
  );

  const processSummaries: ProcessKpiSummary[] = rows.map((r: any) => ({
    processId:   r.process_id,
    processName: r.process_name,
    branchName:  r.branch_name ?? '—',
    agentCount:  r.agent_count,
    avgScore:    r.avg_score ?? 0,
    topScore:    r.top_score ?? 0,
    bottomScore: r.bottom_score ?? 0,
    sRating:     r.s_rating,
    aRating:     r.a_rating,
    bRating:     r.b_rating,
    cRating:     r.c_rating,
    dRating:     r.d_rating,
  }));

  const allScores = rows.map((r: any) => r.avg_score ?? 0);
  const orgAvgScore = allScores.length > 0
    ? Math.round(allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length * 100) / 100
    : 0;

  return {
    orgAvgScore,
    totalAgentsScored: processSummaries.reduce((sum, p) => sum + p.agentCount, 0),
    periodLabel: yearMonth,
    processSummaries,
    topProcess: processSummaries.length > 0
      ? { processName: processSummaries[0].processName, avgScore: processSummaries[0].avgScore }
      : null,
    bottomProcess: processSummaries.length > 0
      ? { processName: processSummaries[processSummaries.length - 1].processName,
          avgScore:    processSummaries[processSummaries.length - 1].avgScore }
      : null,
  };
}
```

- [ ] **Step 2: Add the endpoint in kpi.routes.ts**

Find the exports section of `kpi.routes.ts` and add:

```typescript
import { getOrgKpiSummary } from './kpi-org-summary.service';

// GET /api/kpi/org-summary?period=2026-06
// Access: super_admin, admin, ceo, coo only
router.get(
  '/org-summary',
  requireRole(['super_admin', 'admin', 'ceo', 'coo']),
  async (req: Request, res: Response) => {
    const period = (req.query.period as string) ?? new Date().toISOString().substring(0, 7);
    try {
      const data = await getOrgKpiSummary(period);
      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to load org KPI summary' });
    }
  }
);
```

- [ ] **Step 3: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/kpi/kpi-org-summary.service.ts \
        backend/src/modules/kpi/kpi.routes.ts
git commit -m "feat(kpi): add org-wide KPI summary endpoint for CEO/COO/Super Admin"
```

---

## Task 5: Add COO to Frontend Role Set and Navigation

**Files:**
- Modify: `src/hooks/useProcessScopedDefaults.ts` (from prior plan)
- Modify: `src/components/layout/navConfig.tsx`

- [ ] **Step 1: Add 'coo' to GLOBAL_ROLE_KEYS in useProcessScopedDefaults.ts**

Find:
```typescript
const GLOBAL_ROLE_KEYS = new Set([
  'super_admin', 'admin', 'hr', 'hr_admin', 'ceo',
  'qa', 'qa_manager', 'analyst', 'finance', 'finance_admin', 'compliance',
]);
```

Change to:
```typescript
const GLOBAL_ROLE_KEYS = new Set([
  'super_admin', 'admin', 'hr', 'hr_admin', 'ceo', 'coo',
  'qa', 'qa_manager', 'analyst', 'finance', 'finance_admin', 'compliance',
]);
```

- [ ] **Step 2: Read navConfig.tsx to find all 'ceo' role arrays**

```bash
grep -n "\"ceo\"\|'ceo'" "src/components/layout/navConfig.tsx"
```
Expected: Several `roles: ["admin","hr","ceo","finance","process_manager","manager"]` arrays.

- [ ] **Step 3: Add 'coo' next to every 'ceo' entry in navConfig.tsx**

For every nav item that has `'ceo'` in its roles array, add `'coo'` right after it.

Example — change:
```typescript
{ label: "CEO Command Center", href: "/management/ceo-command-center", roles: ["admin","hr","ceo","finance","process_manager","manager"] },
{ label: "Business Command Center", href: "/business-command-center", roles: ["admin","ceo","hr","manager","process_manager"] },
{ label: "Agent Performance", href: "/agent-performance", roles: ["admin","hr","ceo","qa","analyst","manager","process_manager","branch_head"] },
{ label: "Reports", href: "/reports", roles: ["admin","hr","manager","ceo","branch_head"] },
```
To:
```typescript
{ label: "CEO Command Center", href: "/management/ceo-command-center", roles: ["admin","hr","ceo","coo","finance","process_manager","manager"] },
{ label: "Business Command Center", href: "/business-command-center", roles: ["admin","ceo","coo","hr","manager","process_manager"] },
{ label: "Agent Performance", href: "/agent-performance", roles: ["admin","hr","ceo","coo","qa","analyst","manager","process_manager","branch_head"] },
{ label: "Reports", href: "/reports", roles: ["admin","hr","manager","ceo","coo","branch_head"] },
```

Also ensure the Security Center and People Experience routes include `coo`:
- `/security-center` — add `'coo'` next to `'ceo'`
- `/people-experience/command-center` — add `'coo'`

- [ ] **Step 4: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProcessScopedDefaults.ts \
        src/components/layout/navConfig.tsx
git commit -m "feat(roles): add coo to frontend global role set and all ceo-level nav items"
```

---

## Task 6: Add COO to App.tsx Route Guards

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Find all route guards containing 'ceo'**

```bash
grep -n "ceo\|CEO" "src/App.tsx" | head -30
```
Expected: Lines like `<PrivateRoute roles={['ceo', 'super_admin']}>` or `allowedRoles={['admin', 'ceo']}`.

- [ ] **Step 2: Add 'coo' to every route guard that includes 'ceo'**

For every occurrence found in Step 1, add `'coo'` to the array. Examples:

```tsx
// Before:
<PrivateRoute roles={['ceo', 'super_admin']}>
  <CeoDashboard />
</PrivateRoute>

// After:
<PrivateRoute roles={['ceo', 'coo', 'super_admin']}>
  <CeoDashboard />
</PrivateRoute>
```

```tsx
// Before (management dashboard route):
<PrivateRoute pageCode="MANAGEMENT_DASHBOARD" roles={['admin', 'hr', 'ceo', 'finance']}>

// After:
<PrivateRoute pageCode="MANAGEMENT_DASHBOARD" roles={['admin', 'hr', 'ceo', 'coo', 'finance']}>
```

- [ ] **Step 3: Also add 'coo' to the Executive Quality route**

Find the route for `ExecutiveQualityDashboard` (if it has a role guard). Add `'coo'` alongside `'ceo'` and `'super_admin'`.

- [ ] **Step 4: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(roles): add coo to all ceo-level route guards in App.tsx"
```

---

## Task 7: Fix ExecutiveQualityDashboard — Add Role Guard + Wire Real API

**Why:** `ExecutiveQualityDashboard.tsx` already calls `/api/executive/quality-summary` (now wired in Task 3) but has no role guard — anyone can access it. Add the guard and ensure it shows process names not codes.

**Files:**
- Modify: `src/pages/ExecutiveQualityDashboard.tsx`

- [ ] **Step 1: Read the first 80 lines to see current data fetching and role check**

```bash
head -80 "src/pages/ExecutiveQualityDashboard.tsx"
```
Expected: See `useQuery` calling `/api/executive/quality-summary?daysBack=` and no `useUserRole` guard.

- [ ] **Step 2: Add role-based access guard at the top of the component**

Add import:
```typescript
import { useUserRole } from '../hooks/useUserRole';
```

At the top of the component function body (before any data fetching):
```typescript
const { data: roleData } = useUserRole();
const isAllowed = roleData?.roleKeys?.some(r =>
  ['super_admin', 'admin', 'ceo', 'coo'].includes(r)
) ?? false;

if (!isAllowed) {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-500 text-sm">You don't have access to this view.</p>
    </div>
  );
}
```

- [ ] **Step 3: Ensure process names display correctly in the process scorecard table**

Find the process scorecard rendering (likely a table with `processName` or `campaign_id` column). Verify it uses `row.processName` or `row.process_name` — not `row.campaign_id` or a numeric ID.

If it currently shows `row.campaign_id` or similar, change to:
```tsx
{row.processName ?? row.process_name ?? row.campaign_id ?? '—'}
```
With the goal that the backend service already returns `process_name` (it does — quality-executive.service.ts JOINs process_master).

- [ ] **Step 4: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/ExecutiveQualityDashboard.tsx
git commit -m "fix(executive-quality): add CEO/COO/SuperAdmin role guard; ensure process names in scorecard"
```

---

## Task 8: Create Frontend Hooks for Executive Data

**Files:**
- Create: `src/hooks/useExecutiveQuality.ts`
- Create: `src/hooks/useOrgKpiSummary.ts`

- [ ] **Step 1: Write useExecutiveQuality.ts**

```typescript
// src/hooks/useExecutiveQuality.ts
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useUserRole } from './useUserRole';

const EXEC_ROLES = new Set(['super_admin', 'admin', 'ceo', 'coo']);

export function useExecutiveQualitySummary(daysBack: 7 | 30 | 90 = 30) {
  const { data: roleData } = useUserRole();
  const isAllowed = roleData?.roleKeys?.some(r => EXEC_ROLES.has(r)) ?? false;

  return useQuery({
    queryKey: ['executive-quality-summary', daysBack],
    queryFn: async () => {
      const { data } = await axios.get('/api/executive/quality-summary', {
        params: { daysBack },
      });
      return data.data as {
        orgKpi: {
          avgQualityScore: number;
          totalCalls: number;
          fatalRate: number;
          excellentRate: number;
        };
        trends: { date: string; avgScore: number; fatalRate: number }[];
        topPerformers: { agentName: string; processName: string; avgScore: number }[];
        bottomPerformers: { agentName: string; processName: string; avgScore: number }[];
        processScorecard: {
          processName: string;
          branchName: string;
          avgScore: number;
          agentCount: number;
          calls: number;
          status: 'green' | 'amber' | 'red';
        }[];
        riskSummary: { criticalAgents: number; atRiskAgents: number; coachingPriority: number };
        benchmarks: { avg: number; median: number; stdDev: number };
      };
    },
    enabled: isAllowed,
    staleTime: 5 * 60 * 1000,
  });
}

export function useExecutiveProcessBreakdown(daysBack: 7 | 30 | 90 = 30) {
  const { data: roleData } = useUserRole();
  const isAllowed = roleData?.roleKeys?.some(r => EXEC_ROLES.has(r)) ?? false;

  return useQuery({
    queryKey: ['executive-quality-process-breakdown', daysBack],
    queryFn: async () => {
      const { data } = await axios.get('/api/executive/quality-summary/process-breakdown', {
        params: { daysBack },
      });
      return data.data as {
        processName: string; branchName: string; avgScore: number;
        agentCount: number; calls: number; status: string;
      }[];
    },
    enabled: isAllowed,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Write useOrgKpiSummary.ts**

```typescript
// src/hooks/useOrgKpiSummary.ts
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useUserRole } from './useUserRole';

const EXEC_ROLES = new Set(['super_admin', 'admin', 'ceo', 'coo']);

export function useOrgKpiSummary(period?: string) {
  const { data: roleData } = useUserRole();
  const isAllowed = roleData?.roleKeys?.some(r => EXEC_ROLES.has(r)) ?? false;

  const defaultPeriod = new Date().toISOString().substring(0, 7); // YYYY-MM
  const activePeriod = period ?? defaultPeriod;

  return useQuery({
    queryKey: ['org-kpi-summary', activePeriod],
    queryFn: async () => {
      const { data } = await axios.get('/api/kpi/org-summary', {
        params: { period: activePeriod },
      });
      return data.data as {
        orgAvgScore: number;
        totalAgentsScored: number;
        periodLabel: string;
        topProcess: { processName: string; avgScore: number } | null;
        bottomProcess: { processName: string; avgScore: number } | null;
        processSummaries: {
          processId: string;
          processName: string;
          branchName: string;
          agentCount: number;
          avgScore: number;
          topScore: number;
          bottomScore: number;
          sRating: number;
          aRating: number;
          bRating: number;
          cRating: number;
          dRating: number;
        }[];
      };
    },
    enabled: isAllowed,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useExecutiveQuality.ts src/hooks/useOrgKpiSummary.ts
git commit -m "feat(executive): add React Query hooks for executive quality and org-wide KPI summary"
```

---

## Task 9: Enhance CEO Dashboard with Quality and KPI Panels

**Why:** `CeoDashboard.tsx` currently only shows headcount/payroll metrics. CEO and COO need quality scores and KPI data on this same page.

**Files:**
- Modify: `src/pages/dashboards/CeoDashboard.tsx`

- [ ] **Step 1: Read lines 1–80 of CeoDashboard.tsx**

```bash
head -80 "src/pages/dashboards/CeoDashboard.tsx"
```
Expected: See existing `useQuery` calls for CEO_DASHBOARD summary, and KPI card rendering.

- [ ] **Step 2: Add imports**

```typescript
import { useExecutiveQualitySummary } from '../../hooks/useExecutiveQuality';
import { useOrgKpiSummary } from '../../hooks/useOrgKpiSummary';
```

- [ ] **Step 3: Add hook calls inside the component**

After existing hooks, add:
```typescript
const { data: execQuality, isLoading: qualityLoading } = useExecutiveQualitySummary(30);
const { data: orgKpi, isLoading: kpiLoading } = useOrgKpiSummary();
```

- [ ] **Step 4: Add Quality Summary panel in JSX — after existing KPI cards**

Find where the 8 KPI metric cards end. After that block, insert:

```tsx
{/* Quality Overview Panel */}
{execQuality && (
  <div className="mt-6">
    <h2 className="text-base font-semibold text-gray-700 mb-3">Quality Overview (Last 30 Days)</h2>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Org Quality Score</p>
        <p className="text-2xl font-bold text-blue-600">
          {execQuality.orgKpi.avgQualityScore}%
        </p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Fatal Call Rate</p>
        <p className="text-2xl font-bold text-red-500">
          {execQuality.orgKpi.fatalRate}%
        </p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Total Calls Audited</p>
        <p className="text-2xl font-bold text-gray-800">
          {execQuality.orgKpi.totalCalls.toLocaleString()}
        </p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Risk Agents</p>
        <p className="text-2xl font-bold text-amber-500">
          {execQuality.riskSummary.atRiskAgents + execQuality.riskSummary.criticalAgents}
        </p>
      </div>
    </div>

    {/* Process Scorecard Table */}
    {execQuality.processScorecard.length > 0 && (
      <div className="mt-4 bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-semibold text-gray-700">Process Quality Scorecard</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Process</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Branch</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Avg Score</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Agents</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Calls</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {execQuality.processScorecard.map(p => (
              <tr key={p.processName} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-800">{p.processName}</td>
                <td className="px-4 py-2 text-gray-600">{p.branchName}</td>
                <td className="px-4 py-2 text-right font-semibold text-gray-800">{p.avgScore}%</td>
                <td className="px-4 py-2 text-right text-gray-600">{p.agentCount}</td>
                <td className="px-4 py-2 text-right text-gray-600">{p.calls?.toLocaleString()}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === 'green'  ? 'bg-green-100 text-green-700' :
                    p.status === 'amber'  ? 'bg-amber-100 text-amber-700' :
                                            'bg-red-100 text-red-700'
                  }`}>
                    {p.status === 'green' ? 'Good' : p.status === 'amber' ? 'Watch' : 'Critical'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)}

{/* KPI Overview Panel */}
{orgKpi && (
  <div className="mt-6">
    <h2 className="text-base font-semibold text-gray-700 mb-3">
      KPI Performance — {orgKpi.periodLabel}
    </h2>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Org Avg KPI Score</p>
        <p className="text-2xl font-bold text-blue-600">{orgKpi.orgAvgScore}%</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Best Process</p>
        <p className="text-lg font-bold text-green-600">{orgKpi.topProcess?.processName ?? '—'}</p>
        <p className="text-sm text-gray-500">{orgKpi.topProcess?.avgScore}%</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <p className="text-xs text-gray-500">Needs Attention</p>
        <p className="text-lg font-bold text-red-500">{orgKpi.bottomProcess?.processName ?? '—'}</p>
        <p className="text-sm text-gray-500">{orgKpi.bottomProcess?.avgScore}%</p>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Ensure COO can also see this page — update the role check at line 127**

Find (per exploration: line 127 of CeoDashboard.tsx):
```typescript
// Something like:
if (!roleData?.roleKeys?.some(r => ['super_admin', 'ceo'].includes(r))) {
```

Change to:
```typescript
if (!roleData?.roleKeys?.some(r => ['super_admin', 'ceo', 'coo'].includes(r))) {
```

- [ ] **Step 6: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/dashboards/CeoDashboard.tsx
git commit -m "feat(ceo-dashboard): add org-wide quality scorecard and KPI panels for CEO/COO/SuperAdmin"
```

---

## Task 10: Add Business Metrics Tab to SuperAdminDashboardV2

**Why:** Super Admin dashboard currently shows only system health (user count, module status). Super Admin should also see the same org-wide business metrics as CEO.

**Files:**
- Modify: `src/pages/SuperAdminDashboardV2.tsx`

- [ ] **Step 1: Read lines 1–60 of SuperAdminDashboardV2.tsx**

```bash
head -60 "src/pages/SuperAdminDashboardV2.tsx"
```
Expected: See existing tabs (or sections) for System Metrics, Module Health, Activity Log.

- [ ] **Step 2: Add imports**

```typescript
import { useExecutiveQualitySummary } from '../hooks/useExecutiveQuality';
import { useOrgKpiSummary } from '../hooks/useOrgKpiSummary';
```

- [ ] **Step 3: Add hook calls**

```typescript
const { data: execQuality } = useExecutiveQualitySummary(30);
const { data: orgKpi } = useOrgKpiSummary();
```

- [ ] **Step 4: Add a new "Business Overview" tab**

Find the existing tab/section structure. Add a new tab labelled "Business Overview" that renders the process quality scorecard table (same JSX as Task 9 Step 4 — copy it). This gives Super Admin the same cross-process view as CEO without modifying the existing System tab.

The tab header addition:
```tsx
<button
  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
    activeTab === 'business'
      ? 'border-blue-600 text-blue-600'
      : 'border-transparent text-gray-500 hover:text-gray-700'
  }`}
  onClick={() => setActiveTab('business')}
>
  Business Overview
</button>
```

The tab content (same process scorecard table from Task 9 Step 4).

- [ ] **Step 5: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/SuperAdminDashboardV2.tsx
git commit -m "feat(super-admin): add Business Overview tab with org-wide quality and KPI data"
```

---

## Verification Plan

### Role Access Matrix — Expected Outcomes

| URL | super_admin | ceo | coo (new) | process_manager | employee |
|---|---|---|---|---|---|
| `/ceo/dashboard` | ✅ full data | ✅ full data | ✅ full data | ❌ 403 | ❌ 403 |
| `/quality/executive` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `/super-admin/dashboard` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/api/executive/quality-summary` | ✅ 200 | ✅ 200 | ✅ 200 | ❌ 403 | ❌ 403 |
| `/api/kpi/org-summary` | ✅ 200 | ✅ 200 | ✅ 200 | ❌ 403 | ❌ 403 |
| `/api/org/processes` | ✅ all | ✅ all | ✅ all | ⚠️ only assigned | ❌ |
| CEO Dashboard quality table | Shows ALL process names | Same | Same | N/A | N/A |

### Manual Verification Steps

1. **COO role creation** (staging only):
   ```bash
   mysql -u root -p mas_hrms_staging < backend/src/db/migrations/20260630_coo_role.sql
   # Then: SELECT role_key, role_name FROM roles WHERE role_key = 'coo';
   # Expected: 1 row returned
   ```

2. **CEO/COO quality data**:
   ```bash
   curl "http://localhost:4000/api/executive/quality-summary?daysBack=30" \
     -H "Authorization: Bearer <CEO_TOKEN>"
   # Expected: { success: true, data: { orgKpi: {...}, processScorecard: [...] } }
   # processScorecard entries must show processName like "Inbound Sales", not "397"
   ```

3. **COO token gets same response as CEO**:
   ```bash
   curl "http://localhost:4000/api/executive/quality-summary?daysBack=30" \
     -H "Authorization: Bearer <COO_TOKEN>"
   # Expected: identical response to CEO token
   ```

4. **Process Manager blocked from executive endpoint**:
   ```bash
   curl "http://localhost:4000/api/executive/quality-summary?daysBack=30" \
     -H "Authorization: Bearer <PROCESS_MANAGER_TOKEN>"
   # Expected: HTTP 403
   ```

5. **Org KPI summary**:
   ```bash
   curl "http://localhost:4000/api/kpi/org-summary?period=2026-06" \
     -H "Authorization: Bearer <CEO_TOKEN>"
   # Expected: processSummaries array with processName field populated, not process_id numbers
   ```

6. **CEO Dashboard visual check** — open `/ceo/dashboard` as CEO:
   - Quality Overview panel visible with 4 metric cards
   - Process Scorecard table shows "Inbound Sales", "BGV Helpdesk" etc. — not "397", "398"
   - KPI Overview panel shows org avg + top/bottom process by name

7. **COO nav access** — login as a user with `coo` role:
   - "CEO Command Center", "Business Command Center", "Reports", "Agent Performance" all visible in sidebar
   - `/ceo/dashboard` loads without 403

### Rollback Plan
- COO role migration: `DELETE FROM roles WHERE role_key = 'coo'; DELETE FROM role_page_access WHERE role_key = 'coo';` — fully reversible.
- `requireRole.ts` alias addition: remove the `coo: 'ceo'` entry from the ROLE_ALIASES map.
- `resolveDashboardScope.ts`: remove `'coo'` from GLOBAL_ROLES — one-line change.
- Frontend changes are purely additive — new panels in CEO Dashboard can be removed by deleting the added JSX blocks.
- `quality-executive.routes.ts` — remove file + remove the `app.use('/api/executive', ...)` mount line in `app.ts`.

### Known Gaps / Follow-on Work
- `ManagementDashboard.tsx` — currently single-process. Apply same `useExecutiveQualitySummary` pattern to add a cross-process tab for CEO/COO — deferred to next plan.
- `NativeCEOCommandCenter.tsx` — currently redirects to `/dashboard`. Wire it to `/ceo/dashboard` properly.
- Org-wide Attendance and Leave summaries — not included in this plan; defer as a separate Phase 4 task.
- Super Admin module page-level access grants: currently COO inherits CEO's page codes. If a page code needs to be CEO-only (e.g., payroll config), add a separate exclusion in the migration.
