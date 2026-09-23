# Exit Command Center — Branch Scoping, Role-Gated Clearance, Audit Trail + Full Test Suite
**Date:** 2026-09-23  
**Status:** Approved (v2 — expanded)

---

## 1. Problem Statement

Four gaps exist in the Exit Command Center today:

| # | Gap | Impact |
|---|---|---|
| 1 | `GET /api/exit/command-center` returns all exits org-wide regardless of caller's branch | Branch HR sees Noida-2 data; Process Manager sees unrelated branch exits |
| 2 | Clearance task PATCH has no role-check — any HR/admin/manager can clear any area's task | Manager can mark WFM, IT, Finance tasks cleared without being that role |
| 3 | `exit_clearance_task` stores only `cleared_by` (user ID) — no name, role, or reason | Impossible to audit "who cleared IT access and why" |
| 4 | `full_final_calculation` has no `verified_by` / `verified_at` / `verification_reason` — verify action logged only in sensitive-audit log, not the table row | F&F printout and drawer cannot show who verified and when |

---

## 2. Scope of This Spec

### 2.1 Branch Scoping (Gap 1)

| Role | Visible scope |
|---|---|
| `super_admin`, `payroll_head` | All branches — no filter |
| Everyone else (`admin`, `hr`, `finance`, `payroll`, `ceo`, `manager`, `branch_head`, `process_manager`, `assistant_manager`, `tl`) | Branch(es) assigned to them via `user_assignment_scope` |

Enforced inside `getExitCommandCenter()`. Applied to all four sub-queries: requests list, summary KPIs, attrition trend, analytics breakdown.

### 2.2 Role-Gated Clearance (Gap 2)

Each clearance area has a set of roles that may clear it. Non-matching callers receive 403.
`super_admin` and `admin` bypass all checks.

| clearance_area | Roles that may mark cleared / waived |
|---|---|
| `manager` | manager, assistant_manager, process_manager, branch_head |
| `hr` | hr, admin |
| `compliance` | hr, admin |
| `assets` | admin, hr |
| `it` | it, admin |
| `wfm` | wfm, admin |
| `payroll` | payroll, payroll_head, hr |
| `finance` | finance, payroll_head |

Transitioning to `in_progress` or `blocked` or `pending` is open to any of the above roles (status observation).  
Only `cleared` and `waived` are gated.

### 2.3 Approver Audit Trail (Gaps 3 & 4)

#### exit_clearance_task — new columns (one additive migration)

| Column | Type | Purpose |
|---|---|---|
| `cleared_by_name` | VARCHAR(140) NULL | Full name of the person who cleared/waived |
| `cleared_by_role` | VARCHAR(80) NULL | Role key at time of clearing |
| `clearing_reason` | VARCHAR(700) NULL | Mandatory reason when status = waived; optional when cleared |

#### full_final_calculation — new columns (one additive migration)

| Column | Type | Purpose |
|---|---|---|
| `verified_by` | CHAR(36) NULL | User ID of person who ran verify |
| `verified_by_name` | VARCHAR(140) NULL | Name at time of verify |
| `verified_at` | DATETIME NULL | Timestamp |
| `verification_reason` | VARCHAR(700) NULL | Reason text submitted by verifier |

`exit_approval_log` already stores `action_by`, `action_by_role`, `discussion_remarks`, `created_at` for every FSM status change — no changes needed there.

---

## 3. Exit Type Flows (for complete test coverage)

The `exit_type` column has two values. `exit_sub_type` narrows the reason.

| exit_type | exit_sub_type | FSM path | Notice period |
|---|---|---|---|
| `voluntary` | `resignation` | draft → submitted → manager_review → accepted → notice_serving → exited | Full notice (per contract) |
| `voluntary` | `retirement` | same | Full or waived per HR |
| `voluntary` | `mutual_separation` | draft → submitted → accepted → notice_serving → exited (manager_review optional) | Negotiated |
| `involuntary` | `termination` | draft → submitted → accepted → notice_serving → exited (HR creates; no employee submit step) | Per disciplinary outcome |
| `involuntary` | `absconding` | draft → submitted → accepted → exited (notice_serving skipped; no notice) | None |
| `involuntary` | `contract_end` | same as termination | Per contract end date |
| `involuntary` | `abandonment` | same as absconding | None |

Clearance task generation is valid at `accepted` or later for all sub-types.  
F&F calculation is required before `closed` for all sub-types except `absconding`/`abandonment`
where it may proceed with zero earned leave and zero notice recovery (configurable).

---

## 4. Architecture

### 4.1 Backend Changes — files touched

| File | Change |
|---|---|
| `exit-intelligence.service.ts` | `getExitCommandCenter(scope)` — resolve scope clause; apply to all 4 sub-queries |
| `exit.routes.ts` | Pass `actorUserId` + `actorRoles` to `getExitCommandCenter`; add `CLEARANCE_ROLE_MAP` check in the clearance PATCH handler; write `cleared_by_name`, `cleared_by_role`, `clearing_reason` |
| `ff.service.ts` (or inline in route) | Write `verified_by`, `verified_by_name`, `verified_at`, `verification_reason` on verify action |
| `exit-intelligence.service.ts` | `createDefaultClearanceTasks` unchanged |

### 4.2 Migrations — 2 additive SQL files

**Migration A — `exit_clearance_task` audit columns:**
```sql
ALTER TABLE exit_clearance_task
  ADD COLUMN cleared_by_name   VARCHAR(140) NULL AFTER cleared_by,
  ADD COLUMN cleared_by_role   VARCHAR(80)  NULL AFTER cleared_by_name,
  ADD COLUMN clearing_reason   VARCHAR(700) NULL AFTER cleared_by_role;
```

**Migration B — `full_final_calculation` verify audit columns:**
```sql
ALTER TABLE full_final_calculation
  ADD COLUMN verified_by        CHAR(36)     NULL AFTER is_ff_provisional,
  ADD COLUMN verified_by_name   VARCHAR(140) NULL AFTER verified_by,
  ADD COLUMN verified_at        DATETIME     NULL AFTER verified_by_name,
  ADD COLUMN verification_reason VARCHAR(700) NULL AFTER verified_at;
```

Both are purely additive — no existing rows change, no backfill required.

### 4.3 Clearance Role Gate — implementation detail

In the `PATCH /:id/clearance/:taskId` handler, after fetching the task row:

```typescript
const CLEARANCE_ROLE_MAP: Record<string, string[]> = {
  manager:    ['manager','assistant_manager','process_manager','branch_head'],
  hr:         ['hr','admin'],
  compliance: ['hr','admin'],
  assets:     ['admin','hr'],
  it:         ['it','admin'],
  wfm:        ['wfm','admin'],
  payroll:    ['payroll','payroll_head','hr'],
  finance:    ['finance','payroll_head'],
};

const BYPASS = new Set(['super_admin','admin']);

if (['cleared','waived'].includes(newStatus)) {
  const allowed = CLEARANCE_ROLE_MAP[task.clearance_area] ?? [];
  const callerRoles: string[] = req.authUser!.roles ?? [];
  const canClear = callerRoles.some(r => BYPASS.has(r) || allowed.includes(r));
  if (!canClear) {
    return res.status(403).json({
      success: false,
      code: 'clearance_role_mismatch',
      message: `The ${task.clearance_area} clearance area can only be cleared by: ${allowed.join(', ')}.`,
    });
  }
}
```

When `waived`, `clearing_reason` is mandatory (400 if absent).  
When `cleared`, `clearing_reason` is optional.

### 4.4 Verify F&F — implementation detail

`POST /exit/ff/:id/verify` body must include `reason` (required, 400 if blank).  
The handler writes to `full_final_calculation`:
```sql
UPDATE full_final_calculation
   SET is_ff_provisional    = 0,
       verified_by           = :actorId,
       verified_by_name      = :actorName,
       verified_at           = NOW(),
       verification_reason   = :reason
 WHERE id = :id
```

Actor name resolved from `employees` table by `actorId`.

---

## 5. Test Suite — 5 Contract Test Files

All files use real DB pool, no mocks, AAA pattern.

### 5.1 `exitCommandCenter.scope.contract.test.ts`

| Test | Assertion |
|---|---|
| super_admin sees rows from all branches | `data.requests` spans ≥ 2 branches |
| payroll_head sees rows from all branches | same |
| branch HR scoped to branch A sees only branch A | no row outside scope |
| branch HR KPI counts match filtered row count | `summary.total === data.requests.length` |
| manager scoped to branch B sees only branch B | isolation confirmed |
| user with 2-branch scope sees both | both present, no third |
| user with no scope rows gets empty result | `requests.length === 0` |
| analytics.byBranch for scoped user has only their branch | array length 1 |
| attrition trend months contain only scoped exits | cross-check vs direct DB count |

### 5.2 `exitFsm.transitions.contract.test.ts`

Full coverage of every exit type path.

**Voluntary / Resignation:**
| Test | Assertion |
|---|---|
| Create voluntary/resignation exit (draft) | 201, `status = draft` |
| draft → submitted (employee) | 200 |
| submitted → manager_review (manager in scope) | 200, `exit_approval_log` entry created |
| manager_review → accepted (hr) | 200, log entry created |
| accepted → notice_serving (hr) | 200 |
| notice_serving → exited with open tasks | 409 `open_tasks` |
| notice_serving → exited with all tasks cleared | 200 |
| exited → any state | 409 `terminal_state` |

**Voluntary / Mutual Separation:**
| Test | Assertion |
|---|---|
| accepted → notice_serving skipping manager_review | 200 (allowed by FSM) |

**Involuntary / Termination (HR-initiated):**
| Test | Assertion |
|---|---|
| HR creates exit with exit_type=involuntary, sub_type=termination | 201 |
| submitted → accepted directly (hr, skipping manager_review) | 200 |
| accepted → notice_serving → exited flow | 200 each |

**Involuntary / Absconding:**
| Test | Assertion |
|---|---|
| accepted → exited directly (no notice_serving) | 200 |
| notice_serving skipped → clearance still generates | 200 |

**Shared / Cross-cutting:**
| Test | Assertion |
|---|---|
| manager outside scope tries to advance | 403 |
| employee tries to advance own exit past submitted | 403 |
| skip step (submitted → accepted) | 409 `invalid_transition` |
| revoke from notice_serving (hr) | 200, status = revoked |
| withdraw from submitted (employee) | 200, status = withdrawn |
| approval_log entry exists after every status change | row count increments |
| approval_log contains action_by_role | correct role stored |

### 5.3 `exitClearance.contract.test.ts`

| Test | Assertion |
|---|---|
| Generate creates 8 tasks with correct areas | area list matches spec |
| Generate twice does not duplicate | idempotent |
| **Manager can clear `manager` task** | 200, cleared |
| **Manager cannot clear `wfm` task** | 403 `clearance_role_mismatch` |
| **Manager cannot clear `it` task** | 403 |
| **Manager cannot clear `finance` task** | 403 |
| **WFM role can clear `wfm` task** | 200 |
| **IT role can clear `it` task** | 200 |
| **HR can clear `hr` and `compliance` tasks** | 200 each |
| **Waive without reason** | 400 `reason_required` |
| **Waive with reason** | 200, `clearing_reason` stored in row |
| **Cleared stores `cleared_by_name` and `cleared_by_role`** | columns populated correctly |
| Admin bypasses all role checks | can clear any area |
| clearance count in command-center reflects updates | `clearance_cleared` increments |
| PATCH attachment_url stores file reference | column updated |

### 5.4 `exitFF.contract.test.ts`

| Test | Assertion |
|---|---|
| Create F&F record | 201, `is_ff_provisional = 1`, `status = draft` |
| Salary components pre-fill from payroll package | line items present |
| Outstanding advances pre-fill | `advances_recovery > 0` when advance exists |
| `POST /ff/:id/verify` without reason | 400 |
| `POST /ff/:id/verify` with reason | 200, `is_ff_provisional = 0`, `verified_by` set, `verified_by_name` set, `verified_at` set, `verification_reason` stored |
| Verify twice is idempotent | 200 |
| `POST /ff/:id/approve` on provisional (unverified) | 409 `still_provisional` |
| `POST /ff/:id/approve` on verified | 200, `status = approved`, `approved_by` set, `approved_at` set |
| `POST /ff/:id/paid` on non-approved | 409 |
| `POST /ff/:id/paid` with payment_reference | 200, `status = paid`, `ff_paid_by` set, `ff_paid_at` set |
| Manager cannot verify or approve F&F | 403 |
| Finance can verify, approve, mark paid | 200 each |
| `/compute` returns calculated `net_payable` | present and numeric |
| `/outstanding-advances` scoped to correct employee | no cross-employee leakage |

### 5.5 `exitAnalytics.scope.contract.test.ts`

| Test | Assertion |
|---|---|
| `summary.total` for scoped user equals direct DB count for their branch | exact match |
| `attritionTrend` months sum equals scoped total | sum check |
| `exitReasons` counts ≤ scoped total | no over-count |
| `byBranch` for scoped user shows only one branch | array length = 1 |
| `summary.regrettable` matches scoped health-snapshot rows | exact match |
| super_admin analytics reflects full org | count > scoped user's count |

---

## 6. Migration Numbering

Two new files added to `backend/sql/`:

| File | Content |
|---|---|
| `<next_seq>_exit_clearance_task_audit_columns.sql` | ALTER TABLE exit_clearance_task — add cleared_by_name, cleared_by_role, clearing_reason |
| `<next_seq+1>_full_final_calculation_verify_audit.sql` | ALTER TABLE full_final_calculation — add verified_by, verified_by_name, verified_at, verification_reason |

Sequence numbers assigned during implementation (next after current highest in `backend/sql/`).

---

## 7. Error Handling

| Scenario | HTTP | code |
|---|---|---|
| Clearance area role mismatch | 403 | `clearance_role_mismatch` |
| Waive without reason | 400 | `reason_required` |
| Verify F&F without reason | 400 | `reason_required` |
| Approve provisional F&F | 409 | `still_provisional` |
| Paid on non-approved F&F | 409 | `not_approved` |
| Invalid FSM transition | 409 | `invalid_transition` |
| Terminal state | 409 | `terminal_state` |
| Open clearance tasks on exited transition | 409 | `open_tasks` |

---

## 8. Out of Scope

- Frontend UI changes for the clearance drawer (show cleared_by_name/role inline) — separate task
- Notice Period tab scoping — that endpoint has its own scope logic
- Individual record endpoints (`/:id`, `/:id/full`) — already row-level scoped (2026-08-14)
- Absconding/abandonment special F&F zero-earning config — configurable but not part of this spec
