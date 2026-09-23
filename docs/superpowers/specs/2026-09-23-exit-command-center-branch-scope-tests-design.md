# Exit Command Center — Branch Scoping + Test Suite
**Date:** 2026-09-23
**Status:** Approved

---

## 1. Problem Statement

`GET /api/exit/command-center` calls `getExitCommandCenter()` with no arguments, returning
all exit requests and all analytics across every branch to every caller regardless of role.
A branch HR sees Noida-2 payroll data. A process manager sees exits from unrelated branches.
No row-level isolation exists on any of the six tabs (Overview, Notice Period, Analytics, Bulk
Actions, F&F Settlement, Task Board) because they all operate on the same unscoped payload.

---

## 2. Scoping Rules

| Role | Visible scope |
|---|---|
| `super_admin`, `payroll_head` | All branches — no filter |
| All other roles (admin, hr, finance, payroll, ceo, manager, branch_head, process_manager, assistant_manager, tl) | Branch(es) assigned to them via `user_assignment_scope`, resolved by `buildScopeWhereClause` |

A user with scope over multiple branches (e.g. a regional manager with 3 scope rows) sees all
three combined — `buildScopeWhereClause` already emits an `IN (…)` clause for that case.

---

## 3. Architecture

### 3.1 Chosen Approach

Option A: enforce scope inside `getExitCommandCenter()` itself.

- Single function change, single route change.
- All six tabs automatically scoped — they all read from the same payload.
- Analytics sub-queries (KPIs, attrition trend, exit reasons, by-branch bar) are also scoped,
  so a branch HR's analytics reflect only their branch.

No frontend changes required.

### 3.2 Scope Resolution

```
caller roles include super_admin OR payroll_head?
  YES → scopeWhere = '1=1',  scopeParams = []
  NO  → buildScopeWhereClause(actorUserId, EXIT_VIEW_ROLES, { branchId: 'e.branch_id' })
         returns { sql, params }
```

`EXIT_VIEW_ROLES` = all roles currently listed on the command-center `requireRole(…)` call:
`admin, hr, manager, finance, payroll, ceo` plus the scoped-role set
`branch_head, process_manager, assistant_manager, tl`.

---

## 4. File-by-File Changes

### 4.1 `backend/src/modules/exit/exit-intelligence.service.ts`

**Signature change:**

```typescript
// Before
export async function getExitCommandCenter(filters?: { managerEmployeeId?: string })

// After
export async function getExitCommandCenter(scope: {
  actorUserId: string;
  actorRoles: string[];
}): Promise<ExitCommandCenterData>
```

**Scope resolution (top of function):**

```typescript
const BYPASS_ROLES = new Set(['super_admin', 'payroll_head']);
const isBypassed = scope.actorRoles.some(r => BYPASS_ROLES.has(r));

let scopeWhere: string;
let scopeParams: unknown[];

if (isBypassed) {
  scopeWhere = '1=1';
  scopeParams = [];
} else {
  const s = await buildScopeWhereClause(
    scope.actorUserId,
    EXIT_VIEW_ROLES,
    { branchId: 'e.branch_id' },
  );
  scopeWhere = s.sql;
  scopeParams = s.params;
}
```

**Apply to all four sub-queries** — each already joins `employees e` so `e.branch_id` is available:

1. **Summary KPI sub-query** — append `AND (${scopeWhere})` to its WHERE clause; add `scopeParams` to bind values.
2. **Requests list query** — same.
3. **Attrition trend query** (monthly counts) — same.
4. **Analytics query** (exit reasons + by-branch breakdown) — same.

Remove the old `filters.managerEmployeeId` path entirely — it was unused in production.

### 4.2 `backend/src/modules/exit/exit.routes.ts`

**Route at line ~33:**

```typescript
// Before
h(async (_req, res) =>
  res.json({ success: true, data: await getExitCommandCenter() })
)

// After
h(async (req, res) =>
  res.json({
    success: true,
    data: await getExitCommandCenter({
      actorUserId: req.authUser!.id,
      actorRoles: req.authUser!.roles ?? [],
    }),
  })
)
```

No other route files change.

---

## 5. Test Suite

Five new contract test files. All use the real DB pool (same pattern as the repo's existing
`*.contract.test.ts` files). No mocks. Each follows Arrange–Act–Assert.

### 5.1 `exit/__tests__/exitCommandCenter.scope.contract.test.ts`

Covers: command-center scope enforcement.

| Test case | Assertion |
|---|---|
| super_admin sees rows from all branches | `data.requests` contains rows from ≥ 2 distinct branches |
| payroll_head sees rows from all branches | same |
| branch HR (scoped to branch A) sees only branch A rows | no row has `branch_id` outside the actor's scope |
| branch HR KPI counts match filtered row count | `summary.total === data.requests.length` |
| manager scoped to branch B sees only branch B rows | isolation confirmed |
| user with scope over 2 branches sees both | rows from both branches present, no third |
| actor with no scope rows gets empty result | `data.requests.length === 0` |
| analytics.byBranch for scoped user contains only their branch | array length === 1, correct branch name |

### 5.2 `exit/__tests__/exitFsm.transitions.contract.test.ts`

Covers: every FSM status transition via `PATCH /api/exit/:id/status`.

| Test case | Assertion |
|---|---|
| draft → submitted (valid) | 200, status updated |
| submitted → manager_review (manager role, in scope) | 200 |
| manager_review → accepted (hr role) | 200 |
| accepted → notice_serving (hr role) | 200 |
| notice_serving → exited with open clearance tasks | 409 with `open_tasks` error code |
| notice_serving → exited with all tasks cleared/waived | 200 |
| accepted → clearance_pending (hr role) | 200 |
| clearance_pending → fnf_pending (hr role) | 200 |
| fnf_pending → closed (finance role) | 200 |
| any terminal state → any state | 409 `terminal_state` |
| skip step (submitted → accepted) | 409 `invalid_transition` |
| manager outside scope tries to advance | 403 |
| employee tries to advance own exit to manager_review | 403 |
| revoke from notice_serving (hr role) | 200, status = revoked |
| withdraw from submitted (employee role) | 200, status = withdrawn |

### 5.3 `exit/__tests__/exitClearance.contract.test.ts`

Covers: clearance task generation and lifecycle.

| Test case | Assertion |
|---|---|
| `POST /exit/:id/clearance/generate` creates 8 tasks | tasks with correct dept labels |
| calling generate twice does NOT duplicate tasks | second call returns existing tasks unchanged |
| `PATCH /exit/:id/clearance/:taskId` → cleared | task status = cleared |
| `PATCH /exit/:id/clearance/:taskId` → waived with reason | status = waived, reason stored |
| clearance count in command-center reflects updates | `clearance_cleared` increments |
| LWD trigger service marks tasks pending on LWD date | integration with `exit-clearance-lwd-trigger.service.ts` |
| non-hr role cannot generate clearance | 403 |

### 5.4 `exit/__tests__/exitFF.contract.test.ts`

Covers: Full & Final settlement flow.

| Test case | Assertion |
|---|---|
| `POST /exit/ff/:exitRequestId` creates F&F record | 201, `is_ff_provisional = 1` |
| save with salary components pre-fills from payroll package | line items present |
| outstanding advances included in pre-fill | `advances_recovery` > 0 when advance exists |
| `POST /exit/ff/:id/verify` clears provisional flag | `is_ff_provisional = 0` |
| verify on already-verified record is idempotent | 200, no error |
| `POST /exit/ff/:id/approve` sets approved status | `status = approved` |
| approve on non-verified (still provisional) record | 409 `still_provisional` |
| `POST /exit/ff/:id/paid` marks settlement paid | `status = paid`, `paid_at` set |
| paid on non-approved record | 409 |
| finance role can verify, approve, mark paid | 200 |
| manager role cannot approve F&F | 403 |
| `/compute` endpoint returns calculated breakdown | `net_payable` figure present |
| `/outstanding-advances` returns only unpaid advances for the employee | correct employee scoping |

### 5.5 `exit/__tests__/exitAnalytics.scope.contract.test.ts`

Covers: analytics sub-queries correctly scoped.

| Test case | Assertion |
|---|---|
| `summary.total` for scoped user equals count of their branch's exits | exact match |
| `analytics.attritionTrend` months contain only scoped branch exits | cross-check against direct DB count |
| `analytics.exitReasons` pie data is branch-scoped | reason counts ≤ total in scope |
| `analytics.byBranch` for scoped user shows only one branch entry | array length = 1 |
| `summary.regrettable` count matches scoped health-snapshot rows | exact match |

---

## 6. Error Handling

- If `buildScopeWhereClause` returns `{ sql: '1=0' }` (user exists but has no scope rows), the result is an empty dataset — not an error. This is correct: a newly-created role with no assignments should see nothing.
- No new error types introduced. Existing route error handling unchanged.

---

## 7. Rollback

Both changes are additive-compatible: adding a parameter to an internal function and passing two fields from `req.authUser` (already present on every authenticated request). No schema migration required. Reverting is a single-commit revert.

---

## 8. Out of Scope

- Frontend branch filter dropdown for super_admin — not needed; they see all data and can use the existing search/status filter already on the page.
- Scoping the Notice Period tab — it calls `/api/manpower-risk/notice-period` which has its own scope logic; not changed here.
- Scoping individual record endpoints (`/:id`, `/:id/full`) — already done (row-level `canViewEmployee` guard added 2026-08-14).
