# RBAC Process Scoping & Process Name Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every Process Manager, Branch Head, and Manager who logs in sees only their own team's data across all dashboards (Quality, Operations, KPI, Call Master), and that every dashboard shows human-readable process names instead of raw IDs or codes like "397".

**Architecture:** Two parallel tracks — (1) backend: harden the existing `resolveScope()` pattern from `quality-dashboard.routes.ts` and extend it as a shared middleware into Operations and KPI routes that are currently unscoped; (2) frontend: add a `useProcessScopedDefaults` hook that reads the logged-in user's scopes from `useUserRole` and pre-fills process/branch filters, preventing managers from seeing the "all processes" view. Process name resolution is fixed by ensuring the backend always JOINs `process_master` before returning IDs.

**Tech Stack:** Express + TypeScript (backend); React 18 + TypeScript + React Query + Zustand (frontend); MySQL `mas_hrms`; existing `scopeAccess.ts`, `user_assignment_scope`, `process_master`, `employees` tables.

---

## Context

### What currently works
- `quality-dashboard.routes.ts` has a complete `resolveScope()` function that correctly filters by `campaignIds` (process names) for Process Managers and `agentCodes` for Branch Heads.
- `scopeAccess.ts` has a full `hasScopedAccess()` framework.
- `requireRole.ts` enforces role gating with alias expansion (`process_manager ↔ manager`, `team_leader ↔ tl`).
- `useUserRole.ts` in the frontend fetches `WorkforceScope[]` including `process_id`.
- `useEmployeeProfile.ts` fetches `process_id` + `process_name` for the logged-in employee.

### What is broken / missing
1. **Operations routes** (`operations-live.routes.ts`) check roles but do NOT scope data — a Process Manager sees all branches.
2. **KPI routes** have `requireScopedRole` on assignments but leaderboard endpoint is unscoped.
3. **Call Master KPI routes** (from prior plan) have no scope enforcement at all.
4. **Frontend dashboards do NOT auto-apply the user's process scope** — they default to "all data" with an optional manual selector. A Process Manager can see all processes if they open the page directly.
5. **Raw ID display**: `NativeQualityDashboard.tsx` lines 394 and 468 fall back to rendering `c.client_id` when `c.client_name` is absent. `NativeERP.tsx` and `NativeATSExtensions.tsx` have same pattern.
6. **Quality dashboard `clients` API** may return `client_id` without `client_name` if the JOIN to `client_master` fails or is missing.

### RBAC Roles that need process-scoped views
| Role | Expected Scope |
|---|---|
| `process_manager` / `manager` | Only their assigned processes (from `user_assignment_scope`) |
| `branch_head` / `bm` | Only employees in their assigned branch |
| `team_leader` / `tl` | Only their direct team (manager_employee_id scope) |
| `qa` / `qa_manager` | Global quality data (read-only) |
| `hr_admin` / `hr` | Global |
| `super_admin` / `admin` / `ceo` | Global |
| `employee` | Only their own records (self scope) |

---

## File Structure

### Backend files to create/modify
```
backend/src/shared/
  resolveDashboardScope.ts          ← NEW: extracted, reusable version of resolveScope()
                                         (replaces duplicated logic in quality-dashboard.routes.ts)

backend/src/modules/operations/
  operations-live.routes.ts         ← MODIFY: add scope enforcement using resolveDashboardScope

backend/src/modules/kpi/
  kpi.routes.ts                     ← MODIFY: scope leaderboard + scores endpoints

backend/src/modules/quality-dashboard/
  call-master-kpi.routes.ts         ← MODIFY: add scope enforcement (from prior plan)
  quality-dashboard.routes.ts       ← MODIFY: replace local resolveScope() with shared one

backend/src/db/migrations/
  20260630_process_name_index.sql   ← NEW: ensure process_master has index on process_code
                                         (needed for JOIN performance in dashboard queries)
```

### Frontend files to create/modify
```
src/hooks/
  useProcessScopedDefaults.ts       ← NEW: returns { defaultProcessId, defaultBranchId, isGlobal }
                                         based on logged-in user's role and scopes

src/pages/
  NativeQualityDashboard.tsx        ← MODIFY: use useProcessScopedDefaults to pre-fill selector;
                                         fix client_name fallback (never render raw ID)
  ManagerQualityDashboard.tsx       ← MODIFY: use useProcessScopedDefaults to pre-fill
  AgentQualityDashboard.tsx         ← MODIFY: lock to self scope (no selector at all)
  NativeOperationsDashboard.tsx     ← MODIFY: use useProcessScopedDefaults to pre-fill
  NativeOperationsKPI.tsx           ← MODIFY: use useProcessScopedDefaults to pre-fill

src/components/dashboard/
  ScopedFilterBar.tsx               ← MODIFY: accept `locked` prop — when true, hide the
                                         process selector entirely (used for employees/TLs)
```

---

## Task 1: Extract `resolveDashboardScope` as a Shared Backend Utility

**Why:** `quality-dashboard.routes.ts` has a local `resolveScope()` that correctly handles process_manager, branch_head, and global roles. Operations and KPI routes lack this. Extract it once, reuse everywhere.

**Files:**
- Create: `backend/src/shared/resolveDashboardScope.ts`
- Read first: `backend/src/shared/scopeAccess.ts` and `backend/src/shared/accessGuard.ts`

- [ ] **Step 1: Read the existing resolveScope in quality-dashboard.routes.ts**

```bash
grep -n "resolveScope\|campaignIds\|agentCodes\|global" "backend/src/modules/quality-dashboard/quality-dashboard.routes.ts" | head -60
```
Expected: See the local `resolveScope` async function returning `{ global, campaignIds, agentCodes }`.

- [ ] **Step 2: Read scopeAccess.ts to understand what imports are available**

```bash
cat backend/src/shared/scopeAccess.ts | head -80
```
Expected: See `hasScopedAccess`, `getUserAssignmentScopes`, exported types.

- [ ] **Step 3: Create the shared utility**

```typescript
// backend/src/shared/resolveDashboardScope.ts
// Resolves what data a user can see based on their role and assignment scopes.
// Returns: global=true (see everything), or lists of campaignIds/agentCodes to filter by.

import { Request } from 'express';
import db from '../db';   // adjust to actual db import in this codebase

export interface DashboardScope {
  global: boolean;
  campaignIds: string[] | null;   // process_name values (for process_manager role)
  agentCodes: string[] | null;    // employee_code values (for branch_head role)
}

const GLOBAL_ROLES = new Set([
  'super_admin', 'admin', 'hr', 'hr_admin', 'ceo', 'qa', 'qa_manager', 'analyst',
  'finance', 'finance_admin', 'compliance',
]);

const PROCESS_SCOPED_ROLES = new Set(['process_manager', 'manager']);
const BRANCH_SCOPED_ROLES  = new Set(['branch_head', 'bm']);
const TEAM_SCOPED_ROLES    = new Set(['team_leader', 'tl']);

function hasRole(userRoles: string[], candidates: Set<string>): boolean {
  return userRoles.some(r => candidates.has(r));
}

export async function resolveDashboardScope(req: Request): Promise<DashboardScope> {
  const userId: string = (req as any).authUser?.id;
  if (!userId) return { global: false, campaignIds: [], agentCodes: [] };

  // Resolve user's roles from DB
  const [roleRows] = await db.execute<any[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND is_active = 1`,
    [userId]
  );
  const userRoles: string[] = roleRows.map((r: any) => r.role_key);

  if (hasRole(userRoles, GLOBAL_ROLES)) {
    return { global: true, campaignIds: null, agentCodes: null };
  }

  // Process Manager — scoped to their assigned processes
  if (hasRole(userRoles, PROCESS_SCOPED_ROLES)) {
    const [scopeRows] = await db.execute<any[]>(
      `SELECT DISTINCT pm.process_name
       FROM user_assignment_scope uas
       JOIN process_master pm ON pm.id = uas.process_id
       WHERE uas.user_id = ?
         AND uas.role_key IN ('process_manager', 'manager')
         AND pm.active_status = 1`,
      [userId]
    );
    const campaignIds = scopeRows.map((r: any) => r.process_name);
    if (campaignIds.length === 0) {
      // Fallback: get from employee record
      const [empRows] = await db.execute<any[]>(
        `SELECT pm.process_name
         FROM employees e
         JOIN process_master pm ON pm.id = e.process_id
         WHERE e.user_id = ? AND e.active_status = 1
         LIMIT 1`,
        [userId]
      );
      if (empRows.length > 0) campaignIds.push((empRows[0] as any).process_name);
    }
    return { global: false, campaignIds, agentCodes: null };
  }

  // Branch Head — scoped to all employees in their branch
  if (hasRole(userRoles, BRANCH_SCOPED_ROLES)) {
    const [empRows] = await db.execute<any[]>(
      `SELECT e.branch_id FROM employees e WHERE e.user_id = ? AND e.active_status = 1 LIMIT 1`,
      [userId]
    );
    if (empRows.length === 0) return { global: false, campaignIds: [], agentCodes: [] };

    const branchId = (empRows[0] as any).branch_id;
    const [agentRows] = await db.execute<any[]>(
      `SELECT employee_code FROM employees WHERE branch_id = ? AND active_status = 1`,
      [branchId]
    );
    const agentCodes = agentRows.map((r: any) => r.employee_code);
    return { global: false, campaignIds: null, agentCodes };
  }

  // Team Leader — scoped to their direct reports
  if (hasRole(userRoles, TEAM_SCOPED_ROLES)) {
    const [managerEmpRows] = await db.execute<any[]>(
      `SELECT e.id AS emp_id FROM employees e WHERE e.user_id = ? AND e.active_status = 1 LIMIT 1`,
      [userId]
    );
    if (managerEmpRows.length === 0) return { global: false, campaignIds: [], agentCodes: [] };

    const managerId = (managerEmpRows[0] as any).emp_id;
    const [teamRows] = await db.execute<any[]>(
      `SELECT e.employee_code
       FROM employees e
       JOIN user_assignment_scope uas ON uas.manager_employee_id = ? AND uas.scope_type = 'team'
       WHERE e.id = uas.user_id AND e.active_status = 1`,
      [managerId]
    );
    // Fallback: direct reports by manager_id in employees
    const [directRows] = await db.execute<any[]>(
      `SELECT employee_code FROM employees WHERE manager_id = ? AND active_status = 1`,
      [managerId]
    );
    const combined = new Set([
      ...teamRows.map((r: any) => r.employee_code),
      ...directRows.map((r: any) => r.employee_code),
    ]);
    return { global: false, campaignIds: null, agentCodes: Array.from(combined) };
  }

  // Default: no access (employee sees only their own data — handled at endpoint level)
  return { global: false, campaignIds: [], agentCodes: [] };
}

// Helper: build a WHERE clause fragment for quality dashboard queries
// Returns: { clause: string, params: any[] }
export function buildScopeWhereClause(
  scope: DashboardScope,
  campaignColumn = 'campaign_id',
  agentColumn    = 'employee_code'
): { clause: string; params: any[] } {
  if (scope.global) return { clause: '1=1', params: [] };
  if (scope.campaignIds && scope.campaignIds.length > 0) {
    const placeholders = scope.campaignIds.map(() => '?').join(',');
    return { clause: `${campaignColumn} IN (${placeholders})`, params: scope.campaignIds };
  }
  if (scope.agentCodes && scope.agentCodes.length > 0) {
    const placeholders = scope.agentCodes.map(() => '?').join(',');
    return { clause: `${agentColumn} IN (${placeholders})`, params: scope.agentCodes };
  }
  // Empty scope → no data
  return { clause: '1=0', params: [] };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors in the new file. Fix any import path issues (db import, type imports).

- [ ] **Step 5: Commit**

```bash
git add backend/src/shared/resolveDashboardScope.ts
git commit -m "feat(rbac): extract shared resolveDashboardScope utility with process/branch/team scoping"
```

---

## Task 2: Fix Quality Dashboard `clients` API — Always Return `client_name`

**Why:** The frontend fallback `c.client_name ?? c.client_id` shows raw IDs because the backend query doesn't JOIN `client_master`. Fix the JOIN in the backend query so `client_name` is always populated.

**Files:**
- Modify: `backend/src/modules/quality-dashboard/quality-dashboard.routes.ts` (clients endpoint)

- [ ] **Step 1: Find the clients endpoint query**

```bash
grep -n "client_name\|client_master\|SELECT.*client" "backend/src/modules/quality-dashboard/quality-dashboard.routes.ts" | head -30
```
Expected: See a SELECT that returns `client_id` but may not JOIN `client_master` for `client_name`.

- [ ] **Step 2: Locate and read the clients query block**

Read the file around line numbers found in Step 1. Identify the exact SQL for the `/clients` endpoint.

- [ ] **Step 3: Update the clients query to always JOIN client_master**

Find the existing query (it will look like this):
```sql
SELECT campaign_id AS client_id, COUNT(*) as total_calls, ...
FROM db_audit.call_quality_assessment
WHERE ...
GROUP BY campaign_id
```

Replace it with:
```sql
SELECT 
  cqa.campaign_id AS client_id,
  COALESCE(cm.client_name, pm.process_name, cqa.campaign_id) AS client_name,
  COUNT(*) AS total_calls,
  ROUND(AVG(cqa.quality_percentage), 2) AS avg_score,
  COUNT(DISTINCT cqa.User) AS agent_count
FROM db_audit.call_quality_assessment cqa
LEFT JOIN mas_hrms.process_master pm 
  ON pm.process_code = cqa.campaign_id AND pm.active_status = 1
LEFT JOIN mas_hrms.client_master cm 
  ON cm.id = pm.client_id AND cm.active_status = 1
WHERE cqa.call_date BETWEEN ? AND ?
  -- scope filter injected here
GROUP BY cqa.campaign_id, cm.client_name, pm.process_name
ORDER BY total_calls DESC
```

The key is the `COALESCE(cm.client_name, pm.process_name, cqa.campaign_id)` — process name is the second fallback, raw ID is last resort only.

- [ ] **Step 4: Also apply scope filtering using the shared utility**

In the `/clients` route handler, add scope resolution at the top:

```typescript
import { resolveDashboardScope, buildScopeWhereClause } from '../../shared/resolveDashboardScope';

// Inside the handler:
const scope = await resolveDashboardScope(req);
const { clause, params } = buildScopeWhereClause(scope, 'cqa.campaign_id', 'cqa.User');
```

Then inject `AND ${clause}` into the WHERE clause and spread `params` into the query parameters array.

- [ ] **Step 5: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/quality-dashboard/quality-dashboard.routes.ts
git commit -m "fix(quality-dashboard): always JOIN client_master for client_name; scope clients endpoint by role"
```

---

## Task 3: Scope All Quality Dashboard Routes via Shared Utility

**Why:** Replace the local `resolveScope()` inside `quality-dashboard.routes.ts` with the new shared `resolveDashboardScope` to keep scoping logic in one place, and verify all existing endpoints (`/summary`, `/trend`, `/agents`, `/fraud-signals`, `/apr`) use it.

**Files:**
- Modify: `backend/src/modules/quality-dashboard/quality-dashboard.routes.ts`

- [ ] **Step 1: Find the local resolveScope function**

```bash
grep -n "^async function resolveScope\|^function resolveScope\|const resolveScope" "backend/src/modules/quality-dashboard/quality-dashboard.routes.ts"
```
Expected: One function definition, note its line number.

- [ ] **Step 2: Add the import at the top of the file**

Find the existing import block and add:
```typescript
import { resolveDashboardScope, buildScopeWhereClause } from '../../shared/resolveDashboardScope';
```

- [ ] **Step 3: Delete the local resolveScope function**

Remove the entire local `resolveScope` function (all lines from `async function resolveScope` to its closing `}`).

- [ ] **Step 4: Replace all calls to `resolveScope(req)` with `resolveDashboardScope(req)`**

```bash
# Check how many calls exist:
grep -n "resolveScope(req\|resolveScope(" "backend/src/modules/quality-dashboard/quality-dashboard.routes.ts"
```

For each call site, change:
```typescript
// Before:
const scope = await resolveScope(req);
```
```typescript
// After:
const scope = await resolveDashboardScope(req);
```

The return shape is identical: `{ global, campaignIds, agentCodes }`.

- [ ] **Step 5: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/quality-dashboard/quality-dashboard.routes.ts
git commit -m "refactor(quality-dashboard): replace local resolveScope with shared resolveDashboardScope"
```

---

## Task 4: Scope Operations Live Routes

**Why:** `operations-live.routes.ts` checks role but returns all-processes data for any role that passes the check. Process Managers must only see their process; Branch Heads must only see their branch.

**Files:**
- Modify: `backend/src/modules/operations/operations-live.routes.ts`

- [ ] **Step 1: Read the current operations routes**

```bash
cat "backend/src/modules/operations/operations-live.routes.ts"
```
Expected: See `/live-status`, `/roster-vs-actual`, `/attrition-risk` handlers. Note whether each calls a service with a `processId` or `branchId` parameter.

- [ ] **Step 2: Read the operations service to understand its filter parameters**

```bash
grep -n "processId\|branchId\|campaignId\|campaign_id\|process_id\|branch_id" "backend/src/modules/operations/operations-live.service.ts" | head -30
```
Expected: See service functions that accept `processId?: string` and/or `branchId?: string`.

- [ ] **Step 3: Add scope resolution to the `/live-status` handler**

Find the `/live-status` handler and modify it to inject scope:

```typescript
import { resolveDashboardScope } from '../../shared/resolveDashboardScope';

// Inside the /live-status handler (after requireRole check passes):
router.get('/live-status',
  requireRole(['operations', 'admin', 'process_manager', 'manager', 'branch_head', 'bm', 'super_admin']),
  async (req, res) => {
    try {
      const scope = await resolveDashboardScope(req);
      
      // Build filter for the service call
      const filter: { processNames?: string[]; branchId?: string } = {};
      if (!scope.global) {
        if (scope.campaignIds && scope.campaignIds.length > 0) {
          filter.processNames = scope.campaignIds;
        } else if (scope.agentCodes && scope.agentCodes.length > 0) {
          // For branch heads, get their branch_id from their employee record
          const [empRow] = await db.execute<any[]>(
            `SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
            [(req as any).authUser?.id]
          );
          if (empRow.length > 0) filter.branchId = (empRow[0] as any).branch_id;
        }
      }
      
      const data = await operationsLiveService.getLiveStatus(filter);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);
```

- [ ] **Step 4: Apply same scope pattern to `/roster-vs-actual` and `/attrition-risk`**

For each handler, the pattern is:
```typescript
const scope = await resolveDashboardScope(req);
const filter = scopeToFilter(scope);  // same logic as above
const data = await operationsLiveService.getRosterVsActual(filter);
```

Extract the scope→filter conversion to a local helper inside the file (one function, called by all 3 handlers):

```typescript
async function scopeToOpsFilter(
  req: Request
): Promise<{ processNames?: string[]; branchId?: string }> {
  const scope = await resolveDashboardScope(req);
  if (scope.global) return {};
  if (scope.campaignIds && scope.campaignIds.length > 0) {
    return { processNames: scope.campaignIds };
  }
  if (scope.agentCodes && scope.agentCodes.length > 0) {
    const [rows] = await db.execute<any[]>(
      `SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
      [(req as any).authUser?.id]
    );
    if (rows.length > 0) return { branchId: (rows[0] as any).branch_id };
  }
  return { processNames: [] }; // empty = no data
}
```

- [ ] **Step 5: Update `operations-live.service.ts` to accept and apply the filter**

For each service function, add the filter parameter. Example for `getLiveStatus`:

```typescript
// backend/src/modules/operations/operations-live.service.ts
export async function getLiveStatus(
  filter: { processNames?: string[]; branchId?: string } = {}
) {
  const { processNames, branchId } = filter;
  
  let whereClause = '1=1';
  const params: any[] = [];
  
  if (processNames && processNames.length > 0) {
    whereClause += ` AND pm.process_name IN (${processNames.map(() => '?').join(',')})`;
    params.push(...processNames);
  }
  if (branchId) {
    whereClause += ` AND e.branch_id = ?`;
    params.push(branchId);
  }
  
  // Use existing query, inject whereClause
  const [rows] = await db.execute<any[]>(
    `SELECT 
       pm.process_name,
       b.branch_name,
       COUNT(e.id) AS headcount,
       -- existing columns
       ...
     FROM employees e
     JOIN process_master pm ON pm.id = e.process_id
     JOIN branches b ON b.id = e.branch_id
     WHERE e.active_status = 1 AND ${whereClause}
     GROUP BY pm.process_name, b.branch_name`,
    params
  );
  return rows;
}
```

- [ ] **Step 6: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/operations/operations-live.routes.ts \
        backend/src/modules/operations/operations-live.service.ts
git commit -m "feat(rbac): scope operations live routes to process_manager/branch_head assignments"
```

---

## Task 5: Scope KPI Leaderboard and Scores Endpoints

**Why:** KPI leaderboard currently returns all processes. Process Managers must see only their processes.

**Files:**
- Modify: `backend/src/modules/kpi/kpi.routes.ts`

- [ ] **Step 1: Find the leaderboard endpoint in kpi.routes.ts**

```bash
grep -n "leaderboard\|/scores\|requireRole" "backend/src/modules/kpi/kpi.routes.ts" | head -20
```
Expected: See `router.get('/leaderboard/:processId/:date', ...)`.

- [ ] **Step 2: Add scope guard to the leaderboard endpoint**

Find the leaderboard handler and wrap it with a scope check:

```typescript
import { resolveDashboardScope } from '../../shared/resolveDashboardScope';

// In the leaderboard handler:
router.get('/leaderboard/:processId/:date',
  requireRole(['admin', 'super_admin', 'manager', 'process_manager', 'branch_head', 'bm', 'qa', 'hr']),
  async (req, res) => {
    const { processId, date } = req.params;
    
    // Verify the requesting user has access to this processId
    const scope = await resolveDashboardScope(req);
    if (!scope.global) {
      if (scope.campaignIds !== null) {
        // Process manager: verify the requested processId maps to one of their processes
        const [pmRow] = await db.execute<any[]>(
          `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`,
          [processId]
        );
        const requestedName = pmRow[0]?.process_name;
        if (!requestedName || !scope.campaignIds.includes(requestedName)) {
          return res.status(403).json({ success: false, error: 'Access denied to this process' });
        }
      }
    }
    
    // Existing handler logic below — unchanged
    const data = await kpiService.getLeaderboard(processId, date);
    return res.json({ success: true, data });
  }
);
```

- [ ] **Step 3: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/kpi/kpi.routes.ts
git commit -m "feat(rbac): scope KPI leaderboard to process_manager's assigned processes"
```

---

## Task 6: Scope Call Master KPI Routes (from prior plan)

**Why:** The Call Master KPI routes added in the prior plan have no scope enforcement — any authenticated user can query any `clientId`.

**Files:**
- Modify: `backend/src/modules/quality-dashboard/call-master-kpi.routes.ts`

- [ ] **Step 1: Read the current call-master-kpi.routes.ts**

```bash
cat "backend/src/modules/quality-dashboard/call-master-kpi.routes.ts"
```

- [ ] **Step 2: Add scope enforcement to all data-query endpoints**

Add this import at the top:
```typescript
import { resolveDashboardScope } from '../../shared/resolveDashboardScope';
```

Add a shared scope-check helper inside the file:
```typescript
async function validateClientAccess(req: Request, clientId: string): Promise<boolean> {
  const scope = await resolveDashboardScope(req);
  if (scope.global) return true;
  
  // For process managers: check if clientId is one of their campaign IDs
  if (scope.campaignIds !== null) {
    // clientId here is a Call Master client code — resolve to process name
    const [rows] = await db.execute<any[]>(
      `SELECT pm.process_name 
       FROM process_master pm 
       JOIN client_master cm ON cm.id = pm.client_id
       WHERE cm.client_code = ? OR pm.process_code = ?
       LIMIT 1`,
      [clientId, clientId]
    );
    const processName = rows[0]?.process_name;
    return !!processName && scope.campaignIds.includes(processName);
  }
  
  return false; // Branch heads can't filter by clientId — must use agent-level
}
```

Apply to each handler at the start of the try block:
```typescript
router.get('/quality-summary', async (req: Request, res: Response) => {
  const { clientId, from, to } = req.query as Record<string, string>;
  if (!clientId || !from || !to) {
    return res.status(400).json({ error: 'clientId, from, to are required' });
  }
  
  const hasAccess = await validateClientAccess(req, clientId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this client/process' });
  }
  
  const data = await getQualitySummary(clientId, from, to);
  return res.json({ data });
});
```

Apply `validateClientAccess` to `/quality-summary`, `/top-agents`, `/sales-funnel`, `/quality-trend`.

- [ ] **Step 3: Compile**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/quality-dashboard/call-master-kpi.routes.ts
git commit -m "feat(rbac): scope Call Master KPI endpoints to process_manager's assigned processes"
```

---

## Task 7: Frontend — `useProcessScopedDefaults` Hook

**Why:** Dashboards show all data by default. A Process Manager who opens NativeQualityDashboard should immediately see their process, not a "please select" empty state or all processes.

**Files:**
- Create: `src/hooks/useProcessScopedDefaults.ts`
- Read first: `src/hooks/useUserRole.ts`, `src/hooks/useEmployeeProfile.ts`

- [ ] **Step 1: Read useUserRole.ts to confirm the scopes shape**

```bash
grep -n "WorkforceScope\|scopes\|process_id\|roleKeys" "src/hooks/useUserRole.ts" | head -20
```
Expected: See `WorkforceScope` type with `process_id: string | null`, `branch_id: string | null`, `scope_type: string`.

- [ ] **Step 2: Read useEmployeeProfile.ts to confirm process_name is available**

```bash
grep -n "process_name\|branch_name\|process_id" "src/hooks/useEmployeeProfile.ts" | head -20
```
Expected: See `process_name: string | null` in the `EmployeeProfile` interface.

- [ ] **Step 3: Create the hook**

```typescript
// src/hooks/useProcessScopedDefaults.ts
// Returns the default process/branch context for the logged-in user.
// - Global roles (admin, hr, ceo, etc.) get isGlobal=true, no defaults imposed.
// - Process managers get their first assigned process as default.
// - Branch heads get their branch as default (no process selector shown).
// - Employees get their own process as default and cannot change it.

import { useUserRole } from './useUserRole';
import { useEmployeeProfile } from './useEmployeeProfile';

const GLOBAL_ROLE_KEYS = new Set([
  'super_admin', 'admin', 'hr', 'hr_admin', 'ceo',
  'qa', 'qa_manager', 'analyst', 'finance', 'finance_admin', 'compliance',
]);

const PROCESS_SCOPED_ROLE_KEYS = new Set(['process_manager', 'manager']);
const BRANCH_SCOPED_ROLE_KEYS  = new Set(['branch_head', 'bm']);

export interface ProcessScopedDefaults {
  isLoading:         boolean;
  isGlobal:          boolean;   // true → user can see/select any process
  isProcessLocked:   boolean;   // true → hide process selector, show fixed name
  isBranchLocked:    boolean;   // true → show branch name only
  defaultProcessId:  string | null;
  defaultProcessName: string | null;
  defaultBranchId:   string | null;
  defaultBranchName: string | null;
  allowedProcessIds: string[];  // empty means all; non-empty means restrict selector options
}

export function useProcessScopedDefaults(): ProcessScopedDefaults {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const { data: profile, isLoading: profileLoading } = useEmployeeProfile();

  const isLoading = roleLoading || profileLoading;

  if (isLoading || !roleData) {
    return {
      isLoading: true,
      isGlobal: false,
      isProcessLocked: false,
      isBranchLocked: false,
      defaultProcessId: null,
      defaultProcessName: null,
      defaultBranchId: null,
      defaultBranchName: null,
      allowedProcessIds: [],
    };
  }

  const roleKeys: string[] = roleData.roleKeys ?? [];

  // Global roles: full access, no defaults
  if (roleKeys.some(r => GLOBAL_ROLE_KEYS.has(r))) {
    return {
      isLoading: false,
      isGlobal: true,
      isProcessLocked: false,
      isBranchLocked: false,
      defaultProcessId: null,
      defaultProcessName: null,
      defaultBranchId: null,
      defaultBranchName: null,
      allowedProcessIds: [],
    };
  }

  // Process manager: default to first assigned process, restrict selector
  if (roleKeys.some(r => PROCESS_SCOPED_ROLE_KEYS.has(r))) {
    const processScopes = (roleData.scopes ?? []).filter(
      s => PROCESS_SCOPED_ROLE_KEYS.has(s.role_key) && s.process_id
    );
    const allowedProcessIds = processScopes
      .map(s => s.process_id)
      .filter((id): id is string => !!id);

    const defaultProcessId = allowedProcessIds[0] ?? profile?.process_id ?? null;
    const defaultProcessName = profile?.process_name ?? null;

    return {
      isLoading: false,
      isGlobal: false,
      isProcessLocked: allowedProcessIds.length === 1,
      isBranchLocked: false,
      defaultProcessId,
      defaultProcessName,
      defaultBranchId: profile?.branch_id ?? null,
      defaultBranchName: profile?.branch_name ?? null,
      allowedProcessIds,
    };
  }

  // Branch head: default to their branch, lock it
  if (roleKeys.some(r => BRANCH_SCOPED_ROLE_KEYS.has(r))) {
    return {
      isLoading: false,
      isGlobal: false,
      isProcessLocked: false,
      isBranchLocked: true,
      defaultProcessId: profile?.process_id ?? null,
      defaultProcessName: profile?.process_name ?? null,
      defaultBranchId: profile?.branch_id ?? null,
      defaultBranchName: profile?.branch_name ?? null,
      allowedProcessIds: [],
    };
  }

  // Employee / team leader / default: see only their own process, locked
  return {
    isLoading: false,
    isGlobal: false,
    isProcessLocked: true,
    isBranchLocked: true,
    defaultProcessId: profile?.process_id ?? null,
    defaultProcessName: profile?.process_name ?? null,
    defaultBranchId: profile?.branch_id ?? null,
    defaultBranchName: profile?.branch_name ?? null,
    allowedProcessIds: profile?.process_id ? [profile.process_id] : [],
  };
}
```

- [ ] **Step 4: Check TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProcessScopedDefaults.ts
git commit -m "feat(rbac): add useProcessScopedDefaults hook for auto-scoped dashboard defaults"
```

---

## Task 8: Wire `useProcessScopedDefaults` into `NativeQualityDashboard`

**Why:** This is the most-used quality dashboard. It has the confirmed ID-rendering bug and no auto-scoping.

**Files:**
- Modify: `src/pages/NativeQualityDashboard.tsx`

- [ ] **Step 1: Find the client selector and the ID-rendering fallback**

```bash
grep -n "client_name\|client_id\|useState.*client\|setClient\|selectedClient" "src/pages/NativeQualityDashboard.tsx" | head -20
```
Expected: See `useState` for selected client, and the `c.client_name ?? c.client_id` fallback.

- [ ] **Step 2: Add the import**

At the top of `NativeQualityDashboard.tsx`, add:
```typescript
import { useProcessScopedDefaults } from '../hooks/useProcessScopedDefaults';
```

- [ ] **Step 3: Use the hook to set initial client selection**

Find where `selectedClient` (or equivalent state) is initialized. Change from:
```typescript
const [selectedClient, setSelectedClient] = useState<string>('');
```
To:
```typescript
const scopeDefaults = useProcessScopedDefaults();
const [selectedClient, setSelectedClient] = useState<string>('');

// Auto-apply scope default once loaded
useEffect(() => {
  if (!scopeDefaults.isLoading && !selectedClient) {
    if (scopeDefaults.defaultProcessId) {
      setSelectedClient(scopeDefaults.defaultProcessId);
    }
  }
}, [scopeDefaults.isLoading, scopeDefaults.defaultProcessId]);
```

- [ ] **Step 4: Fix the ID-rendering bug — line 394**

Find:
```tsx
{(clientsQ.data ?? []).map(c => <option key={c.client_id} value={c.client_id}>{c.client_name ?? c.client_id}</option>)}
```
Replace with:
```tsx
{(clientsQ.data ?? [])
  .filter(c => scopeDefaults.isGlobal || scopeDefaults.allowedProcessIds.length === 0 ||
               scopeDefaults.allowedProcessIds.includes(c.client_id))
  .map(c => (
    <option key={c.client_id} value={c.client_id}>
      {c.client_name ?? c.process_name ?? '—'}
    </option>
  ))}
```

Note: the backend fix in Task 2 ensures `client_name` is always populated. The `?? '—'` is a last-resort safety net only — never render a raw numeric ID.

- [ ] **Step 5: Fix the bar chart fallback — line 468**

Find:
```tsx
display_name: c.client_name ?? c.client_id
```
Replace with:
```tsx
display_name: c.client_name ?? c.process_name ?? '(Unknown)'
```

- [ ] **Step 6: Hide selector for locked users**

Find the `<select>` or `<Select>` component for client selection. Wrap it:
```tsx
{scopeDefaults.isProcessLocked ? (
  <div className="px-3 py-2 rounded-md bg-gray-50 border text-sm font-medium text-gray-700">
    {scopeDefaults.defaultProcessName ?? 'Your Process'}
  </div>
) : (
  <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
    {/* existing options here */}
  </select>
)}
```

- [ ] **Step 7: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/NativeQualityDashboard.tsx
git commit -m "fix(quality-dashboard): auto-scope to user's process; fix ID fallback to never render raw codes"
```

---

## Task 9: Wire Scoped Defaults into `ManagerQualityDashboard` and `NativeOperationsDashboard`

**Why:** Same issue — these dashboards need auto-scoping for Process Managers and Branch Heads.

**Files:**
- Modify: `src/pages/ManagerQualityDashboard.tsx`
- Modify: `src/pages/NativeOperationsDashboard.tsx`

- [ ] **Step 1: Apply the pattern to ManagerQualityDashboard.tsx**

Add import:
```typescript
import { useProcessScopedDefaults } from '../hooks/useProcessScopedDefaults';
```

Find the initial process/client state and add:
```typescript
const scopeDefaults = useProcessScopedDefaults();
const [selectedProcessId, setSelectedProcessId] = useState<string>('');

useEffect(() => {
  if (!scopeDefaults.isLoading && !selectedProcessId && scopeDefaults.defaultProcessId) {
    setSelectedProcessId(scopeDefaults.defaultProcessId);
  }
}, [scopeDefaults.isLoading, scopeDefaults.defaultProcessId]);
```

In the JSX where the process selector renders, apply the same locked/unlocked pattern:
```tsx
{scopeDefaults.isProcessLocked ? (
  <span className="text-sm font-semibold text-gray-700 px-2">
    {scopeDefaults.defaultProcessName ?? 'Your Process'}
  </span>
) : (
  /* existing process selector dropdown */
)}
```

- [ ] **Step 2: Apply the same pattern to NativeOperationsDashboard.tsx**

Add import:
```typescript
import { useProcessScopedDefaults } from '../hooks/useProcessScopedDefaults';
```

Find the process filter state. Add auto-population via `useEffect` (same pattern as Step 1).

For Branch Heads where `isBranchLocked = true`, show:
```tsx
{scopeDefaults.isBranchLocked ? (
  <div className="text-sm font-medium px-2 py-1 bg-blue-50 rounded border border-blue-200">
    Branch: {scopeDefaults.defaultBranchName ?? 'Your Branch'}
  </div>
) : (
  /* existing branch selector */
)}
```

- [ ] **Step 3: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/ManagerQualityDashboard.tsx src/pages/NativeOperationsDashboard.tsx
git commit -m "feat(rbac): auto-scope ManagerQualityDashboard and OperationsDashboard to user's process/branch"
```

---

## Task 10: Fix Process Name Display in `ScopedFilterBar` When Options Are Restricted

**Why:** `ScopedFilterBar` fetches all processes from `/api/org/processes`. Process Managers should only see their own processes in this dropdown, not a full list.

**Files:**
- Modify: `src/components/dashboard/ScopedFilterBar.tsx`
- Modify: `backend/src/modules/org/org.routes.ts` (or wherever `/api/org/processes` is served)

- [ ] **Step 1: Find the /api/org/processes handler**

```bash
grep -rn "org/processes\|/processes" "backend/src/modules/org/" | head -20
grep -rn "router.get.*processes" "backend/src/modules/" | head -10
```
Expected: See the route handler and its query.

- [ ] **Step 2: Add role-based filtering to the processes endpoint**

In the handler for `GET /api/org/processes`, add scope resolution:

```typescript
import { resolveDashboardScope } from '../../shared/resolveDashboardScope';

router.get('/processes', requireRole([/* existing roles */]), async (req, res) => {
  const scope = await resolveDashboardScope(req);
  
  let whereClause = 'pm.active_status = 1';
  const params: any[] = [];
  
  if (!scope.global && scope.campaignIds !== null) {
    if (scope.campaignIds.length === 0) {
      return res.json({ data: [], processes: [] });
    }
    const placeholders = scope.campaignIds.map(() => '?').join(',');
    whereClause += ` AND pm.process_name IN (${placeholders})`;
    params.push(...scope.campaignIds);
  }
  
  const [rows] = await db.execute<any[]>(
    `SELECT pm.id, pm.process_name AS name, pm.process_code, pm.branch_id,
            b.branch_name, cm.client_name
     FROM process_master pm
     LEFT JOIN branches b ON b.id = pm.branch_id
     LEFT JOIN client_master cm ON cm.id = pm.client_id
     WHERE ${whereClause}
     ORDER BY pm.process_name ASC`,
    params
  );
  return res.json({ data: rows, processes: rows });
});
```

- [ ] **Step 3: Compile backend**

```bash
cd "c:\Users\shivamg\Upgraded HRMS\backend" && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: In ScopedFilterBar.tsx, show a locked label when only one process is available**

Add import:
```typescript
import { useProcessScopedDefaults } from '../../hooks/useProcessScopedDefaults';
```

At the top of the component:
```typescript
const scopeDefaults = useProcessScopedDefaults();
```

In the process `<Select>` render:
```tsx
{scopeDefaults.isProcessLocked && scopeDefaults.allowedProcessIds.length <= 1 ? (
  <div className="text-sm font-medium px-3 py-2 bg-gray-50 rounded border">
    {scopeDefaults.defaultProcessName ?? 'Your Process'}
  </div>
) : (
  <Select value={selectedProcess} onValueChange={onProcessChange}>
    <SelectTrigger>
      <SelectValue placeholder="Select process" />
    </SelectTrigger>
    <SelectContent>
      {processes.map(p => (
        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

- [ ] **Step 5: Compile frontend**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/org/org.routes.ts \
        src/components/dashboard/ScopedFilterBar.tsx
git commit -m "feat(rbac): scope /api/org/processes to user role; lock ScopedFilterBar for single-process managers"
```

---

## Task 11: Fix Raw ID Display in NativeERP and NativeATSExtensions

**Why:** Same root cause — backend returns IDs without names, frontend falls back to raw ID text.

**Files:**
- Modify: `src/pages/NativeERP.tsx`
- Modify: `src/pages/NativeATSExtensions.tsx`

- [ ] **Step 1: Fix NativeERP.tsx — 3 instances**

```bash
grep -n "process_name ?? .*process_id\|client_id\|vendor_name" "src/pages/NativeERP.tsx" | head -10
```

For each instance, change the fallback:
```tsx
// Before (3 places):
{c.vendor_name ?? c.client_id ?? "–"}
{bu.process_name ?? bu.process_id}
{inv.process_name ?? inv.process_id}
```
```tsx
// After:
{c.vendor_name ?? c.client_name ?? '—'}
{bu.process_name ?? '—'}
{inv.process_name ?? '—'}
```

The rule: **never render a raw numeric or code ID as display text**. Use `'—'` as the last-resort placeholder.

- [ ] **Step 2: Fix NativeATSExtensions.tsx**

```bash
grep -n "process_name ?? .*process_id" "src/pages/NativeATSExtensions.tsx"
```

Change:
```tsx
{r.process_name ?? r.process_id}
```
To:
```tsx
{r.process_name ?? '—'}
```

- [ ] **Step 3: Compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/NativeERP.tsx src/pages/NativeATSExtensions.tsx
git commit -m "fix(ui): replace raw ID fallbacks with em-dash; never render numeric codes as display text"
```

---

## Task 12: Add Process Index Migration for JOIN Performance

**Files:**
- Create: `backend/src/db/migrations/20260630_process_name_index.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260630_process_name_index.sql
-- Additive: adds indexes to process_master to support the new JOIN patterns
-- in quality dashboard, operations, and org/processes endpoints.
-- Safe to run on live schema — CREATE INDEX IF NOT EXISTS is non-destructive.

ALTER TABLE process_master 
  ADD INDEX IF NOT EXISTS idx_pm_process_name (process_name),
  ADD INDEX IF NOT EXISTS idx_pm_process_code (process_code),
  ADD INDEX IF NOT EXISTS idx_pm_client_id (client_id),
  ADD INDEX IF NOT EXISTS idx_pm_branch_id (branch_id),
  ADD INDEX IF NOT EXISTS idx_pm_active (active_status);

ALTER TABLE user_assignment_scope
  ADD INDEX IF NOT EXISTS idx_uas_user_role (user_id, role_key),
  ADD INDEX IF NOT EXISTS idx_uas_process (process_id),
  ADD INDEX IF NOT EXISTS idx_uas_branch (branch_id);
```

- [ ] **Step 2: Verify file**

```bash
ls "backend/src/db/migrations/20260630_process_name_index.sql"
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/migrations/20260630_process_name_index.sql
git commit -m "perf(db): add indexes on process_master and user_assignment_scope for scope JOIN queries"
```

---

## Verification Plan

### Manual Test Matrix

| Role | Expected Behaviour | How to Test |
|---|---|---|
| `process_manager` assigned to "Inbound Sales" | Quality dashboard auto-selects "Inbound Sales", selector shows only "Inbound Sales", can't view other processes via API | Login as PM user, open `/quality-dashboard` → assert only one process in selector and data scoped |
| `branch_head` assigned to Branch B | Operations dashboard shows only Branch B agents, selector locked to "Branch B" | Login as BH user, check live-status API → assert `branch_name` matches only |
| `manager` assigned to 2 processes | Selector shows only 2 processes; KPI leaderboard returns 403 if they request a 3rd processId | Login as manager, try fetching `/api/kpi/leaderboard/<other-process-id>/2026-06-01` → assert 403 |
| `admin` | All processes visible, no selector restriction | Login as admin, assert full process list loads |
| Any role | No "397", "398" or similar numeric/code strings appear in any dropdown or chart label | Open every dashboard, inspect all visible text |

### API Tests (curl)

```bash
# 1. Verify process list is scoped for a process_manager token
curl -s "http://localhost:4000/api/org/processes" \
  -H "Authorization: Bearer <PM_TOKEN>" | jq '.processes[].name'
# Expected: only their assigned process names, not all processes

# 2. Verify quality summary returns 403 for out-of-scope client
curl -s "http://localhost:4000/api/call-master-kpi/quality-summary?clientId=OTHER_CLIENT&from=2026-06-01&to=2026-06-30" \
  -H "Authorization: Bearer <PM_TOKEN>" | jq '.error'
# Expected: "Access denied to this client/process"

# 3. Verify clients endpoint returns client_name not raw codes
curl -s "http://localhost:4000/api/quality-dashboard/clients?from=2026-06-01&to=2026-06-30" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" | jq '.[] | .client_name'
# Expected: human-readable names, no numeric codes

# 4. Verify operations live-status scoped for branch_head
curl -s "http://localhost:4000/api/operations/live-status" \
  -H "Authorization: Bearer <BH_TOKEN>" | jq '.data[].branch_name' | sort -u
# Expected: only one branch name (theirs)

# 5. Verify KPI leaderboard scope enforcement
curl -s "http://localhost:4000/api/kpi/leaderboard/<OTHER_PROCESS_ID>/2026-06-01" \
  -H "Authorization: Bearer <PM_TOKEN>"
# Expected: {"success":false,"error":"Access denied to this process"}
```

### Rollback Plan
- All backend changes are additive — the shared `resolveDashboardScope.ts` adds a new file, existing routes are modified (not deleted).
- If a scope bug blocks access for a legitimate user, temporarily wrap any `resolveDashboardScope` call in a `try/catch` that defaults to `{ global: true }` to restore access while fixing.
- Frontend changes: if `useProcessScopedDefaults` causes a blank default, the `useEffect` can be removed and the selector reverts to empty-default manual selection.
- Database: index migration is non-destructive (`CREATE INDEX IF NOT EXISTS`); rollback by `DROP INDEX`.

### Known Gaps / Follow-on Work
- `NativeOperationsKPI.tsx` — same scoping pattern needed but not included to keep this plan focused; apply same Task 9 pattern.
- `AgentQualityDashboard.tsx` — should be locked to `self` scope (employee's own records only); needs a separate employee-self endpoint.
- WebSocket handler (`operations-websocket.handler.ts`) — real-time events are not scoped in this plan; that's a follow-on task.
- The `branch_head` → `branchId` resolution in Task 4 does a separate DB query; this can be cached in the `req` object to avoid N+1 if multiple handlers run per request.
