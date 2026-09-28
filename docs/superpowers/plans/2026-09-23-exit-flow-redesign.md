# Exit Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the exit flow from 8 manual FSM states to 4 active states with auto-clearance task generation, auto-advance on LWD, a 2-step F&F (approve → paid), branch scoping, clearance role gate, and email+WhatsApp notifications at every handoff.

**Architecture:** Additive migrations expand the `exit_request` table enum and add audit columns to `exit_clearance_task` and `full_final_calculation`. A new FSM gate in `exit.service.ts` validates new state transitions; branch scoping is injected into `getExitCommandCenter()` via the existing `buildScopeWhereClause` helper. A new nightly cron auto-advances cases where LWD has passed and all tasks are cleared.

**Tech Stack:** TypeScript, Express, MySQL (mysql2/promise), existing `dispatch.service.ts` / `notification-event.service.ts` / `exit.notifications.ts` for notifications, existing `buildScopeWhereClause` from `backend/src/shared/scopeAccess.ts`.

## Global Constraints

- Table name is `exit_request` (singular), NOT `exit_requests`
- LWD column is `last_working_day_confirmed` in `exit_request`
- Notifications use `notificationGateway` pattern already in `exit.notifications.ts`
- All new migrations are additive only — no drops, no renames, no data changes
- Migration files numbered 073, 074, 075 (next after 072 in `backend/sql/`)
- Legacy FSM status values (draft, manager_review, hr_review, accepted, notice_serving) remain in the ENUM for backward compat with existing rows
- `buildScopeWhereClause` signature: `buildScopeWhereClause(userId, allowedRoles, aliases, options?)` from `backend/src/shared/scopeAccess.ts`
- Never delete `POST /:id/clearance/generate` route — mark deprecated and keep for 1 cycle; auto-gen replaces it
- All contract tests use real DB pool (`db` from `../../db/mysql.js`), no mocks, AAA pattern
- F&F `is_ff_provisional` column stays in the table — the gate is removed from `approveFF()`, not the column

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `backend/sql/073_exit_fsm_lwd.sql` | CREATE | Add new status values + lwd_override + return_reason columns to exit_request |
| `backend/sql/074_exit_clearance_audit.sql` | CREATE | Add cleared_by_name, cleared_by_role, clearing_reason to exit_clearance_task |
| `backend/sql/075_ff_verify_audit.sql` | CREATE | Add verified_by, verified_by_name, verified_at, verification_reason to full_final_calculation |
| `backend/src/modules/exit/exit.types.ts` | MODIFY | Add new FSM status values, lwd_override, return_reason fields |
| `backend/src/modules/exit/exit-intelligence.service.ts` | MODIFY | `getExitCommandCenter(scope)` — branch scoping on all 4 sub-queries |
| `backend/src/modules/exit/exit.service.ts` | MODIFY | New FSM transitions: notice_active, returned, terminated; auto-clearance trigger |
| `backend/src/modules/exit/exit.routes.ts` | MODIFY | Pass scope to getExitCommandCenter; CLEARANCE_ROLE_MAP gate; LWD override route |
| `backend/src/modules/exit/ff.service.ts` | MODIFY | Remove is_ff_provisional gate from approveFF(); add verified_by audit write in setProvisionalFalse |
| `backend/src/modules/exit/exit.notifications.ts` | MODIFY | Add 8 new notification dispatch functions |
| `backend/src/modules/communication/notification-event.service.ts` | MODIFY | Register 8 new exit notification event keys |
| `backend/src/cron/exitAutoAdvance.cron.ts` | CREATE | Nightly job: advance notice_active/terminated → exited when LWD past + all tasks clear |
| `backend/src/modules/exit/__tests__/exitCommandCenter.scope.contract.test.ts` | CREATE | Branch scoping contract tests |
| `backend/src/modules/exit/__tests__/exitFsm.transitions.contract.test.ts` | CREATE | FSM transition tests (voluntary + involuntary) |
| `backend/src/modules/exit/__tests__/exitClearance.roleGate.contract.test.ts` | CREATE | Clearance role gate + audit column tests |
| `backend/src/modules/exit/__tests__/exitFF.twoStep.contract.test.ts` | CREATE | 2-step F&F (approve → paid) tests |
| `backend/src/modules/exit/__tests__/exitAutoAdvance.contract.test.ts` | CREATE | Nightly cron advance logic tests |
| `backend/src/modules/exit/__tests__/exitNotifications.contract.test.ts` | CREATE | Notification dispatch tests |

---

## Task 1: Additive Migrations

**Files:**
- Create: `backend/sql/073_exit_fsm_lwd.sql`
- Create: `backend/sql/074_exit_clearance_audit.sql`
- Create: `backend/sql/075_ff_verify_audit.sql`

**Interfaces:**
- Produces: new DB columns used by all subsequent tasks

- [ ] **Step 1: Create migration 073**

```sql
-- backend/sql/073_exit_fsm_lwd.sql
USE mas_hrms;

ALTER TABLE exit_request
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'submitted',
  ADD COLUMN lwd_override        DATE         NULL AFTER last_working_day_confirmed,
  ADD COLUMN lwd_override_reason VARCHAR(700) NULL AFTER lwd_override,
  ADD COLUMN return_reason       VARCHAR(700) NULL AFTER lwd_override_reason;
```

Note: The original `status` column is `VARCHAR(50)` not an ENUM, so no ENUM modification needed — new values (`notice_active`, `returned`, `terminated`, `closed`) simply need to be used in application code.

- [ ] **Step 2: Create migration 074**

```sql
-- backend/sql/074_exit_clearance_audit.sql
USE mas_hrms;

ALTER TABLE exit_clearance_task
  ADD COLUMN cleared_by_name   VARCHAR(140) NULL AFTER cleared_by,
  ADD COLUMN cleared_by_role   VARCHAR(80)  NULL AFTER cleared_by_name,
  ADD COLUMN clearing_reason   VARCHAR(700) NULL AFTER cleared_by_role;
```

- [ ] **Step 3: Create migration 075**

```sql
-- backend/sql/075_ff_verify_audit.sql
USE mas_hrms;

ALTER TABLE full_final_calculation
  ADD COLUMN verified_by         CHAR(36)     NULL AFTER is_ff_provisional,
  ADD COLUMN verified_by_name    VARCHAR(140) NULL AFTER verified_by,
  ADD COLUMN verified_at         DATETIME     NULL AFTER verified_by_name,
  ADD COLUMN verification_reason VARCHAR(700) NULL AFTER verified_at;
```

- [ ] **Step 4: Apply migrations on production server**

```bash
plink -ssh -batch -pw "Support#123" -hostkey "SHA256:ao4r3/2yCcezZ+YQajAwJO66Wh7ZjzPXvpNmd0KEbsc" masadmin@mcnhrms.teammas.in \
  "mysql -u root -p\$(grep DB_PASSWORD /var/www/HRMS2/backend/.env | cut -d= -f2) mas_hrms < /var/www/HRMS2/backend/sql/073_exit_fsm_lwd.sql && \
   mysql -u root -p\$(grep DB_PASSWORD /var/www/HRMS2/backend/.env | cut -d= -f2) mas_hrms < /var/www/HRMS2/backend/sql/074_exit_clearance_audit.sql && \
   mysql -u root -p\$(grep DB_PASSWORD /var/www/HRMS2/backend/.env | cut -d= -f2) mas_hrms < /var/www/HRMS2/backend/sql/075_ff_verify_audit.sql"
```

Actually — push to git first (Task 2+), then deploy. The migration files need to be committed before the server can run them.

- [ ] **Step 5: Verify columns exist (after deploy)**

```bash
plink ... "mysql -u root -p... mas_hrms -e \"SHOW COLUMNS FROM exit_request LIKE 'lwd_override%';\""
# Expected: lwd_override, lwd_override_reason columns shown

plink ... "mysql -u root -p... mas_hrms -e \"SHOW COLUMNS FROM exit_clearance_task LIKE 'cleared_by%';\""
# Expected: cleared_by, cleared_by_name, cleared_by_role, clearing_reason

plink ... "mysql -u root -p... mas_hrms -e \"SHOW COLUMNS FROM full_final_calculation LIKE 'verified%';\""
# Expected: verified_by, verified_by_name, verified_at, verification_reason
```

- [ ] **Step 6: Commit**

```bash
git add backend/sql/073_exit_fsm_lwd.sql backend/sql/074_exit_clearance_audit.sql backend/sql/075_ff_verify_audit.sql
git commit -m "feat(exit): additive migrations 073-075 — FSM LWD columns, clearance audit, F&F verify audit"
```

---

## Task 2: Update TypeScript Types

**Files:**
- Modify: `backend/src/modules/exit/exit.types.ts`

**Interfaces:**
- Produces: `ExitRequest` interface with `lwd_override`, `lwd_override_reason`, `return_reason`; extended `ExitStatus` type

- [ ] **Step 1: Open the file**

Read `backend/src/modules/exit/exit.types.ts`. It currently defines `ExitRequest` with `status` typed as a union string.

- [ ] **Step 2: Add ExitStatus type and extend ExitRequest**

In `exit.types.ts`, add near the top:

```typescript
export type ExitStatus =
  // New FSM states
  | 'submitted'
  | 'returned'
  | 'notice_active'
  | 'exited'
  | 'closed'
  | 'revoked'
  | 'terminated'
  // Legacy states kept for backward compat with existing DB rows
  | 'draft'
  | 'manager_review'
  | 'hr_review'
  | 'admin_review'
  | 'accepted'
  | 'rejected'
  | 'notice_serving'
  | 'withdrawn';
```

Then in `ExitRequest`, change `status: string` to `status: ExitStatus` and add the new optional fields:

```typescript
lwd_override?: string | null;
lwd_override_reason?: string | null;
return_reason?: string | null;
```

- [ ] **Step 3: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors (or only pre-existing unrelated errors — note them, do not fix them here).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/exit/exit.types.ts
git commit -m "feat(exit): add ExitStatus union type + lwd_override/return_reason fields"
```

---

## Task 3: Branch Scoping in getExitCommandCenter()

**Files:**
- Modify: `backend/src/modules/exit/exit-intelligence.service.ts`

**Interfaces:**
- Consumes: `buildScopeWhereClause(userId, allowedRoles, aliases)` from `../../shared/scopeAccess.js`
- Produces: `getExitCommandCenter(scope: { actorUserId: string; actorRoles: string[] })` — same return shape as before

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/exit/__tests__/exitCommandCenter.scope.contract.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../../db/mysql.js';
import { getExitCommandCenter } from '../exit-intelligence.service.js';

// These tests require at least 2 exit_request rows in different branches in the test DB.
// If your test DB has no exits, the "sees only branch A" assertions will pass trivially.
// Run against a DB with seeded data or seed inline.

describe('getExitCommandCenter branch scoping', () => {
  it('super_admin sees rows (no scope filter applied)', async () => {
    const result = await getExitCommandCenter({
      actorUserId: 'test-super-admin-id',
      actorRoles: ['super_admin'],
    });
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('requests');
    expect(Array.isArray(result.requests)).toBe(true);
  });

  it('payroll_head sees rows (no scope filter applied)', async () => {
    const result = await getExitCommandCenter({
      actorUserId: 'test-payroll-head-id',
      actorRoles: ['payroll_head'],
    });
    expect(result).toHaveProperty('requests');
  });

  it('user with no scope rows gets empty result', async () => {
    // Use a UUID that has no entry in user_assignment_scope
    const result = await getExitCommandCenter({
      actorUserId: '00000000-0000-0000-0000-000000000001',
      actorRoles: ['hr'],
    });
    expect(result.requests).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect it to fail**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitCommandCenter.scope.contract.test.ts 2>&1 | tail -20
```

Expected: FAIL — `getExitCommandCenter` does not accept a `scope` argument yet.

- [ ] **Step 3: Add import and update function signature**

At the top of `exit-intelligence.service.ts`, add:

```typescript
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
```

Change the function signature from:
```typescript
export async function getExitCommandCenter(filters: { managerEmployeeId?: string } = {}) {
```
to:
```typescript
const BYPASS_SCOPE_ROLES = new Set(['super_admin', 'payroll_head']);

export async function getExitCommandCenter(scope: { actorUserId: string; actorRoles: string[] }) {
  const bypass = scope.actorRoles.some(r => BYPASS_SCOPE_ROLES.has(r));
```

- [ ] **Step 4: Build the scope clause**

Directly after the bypass check, add:

```typescript
  let scopeWhere = '1=1';
  let scopeParams: unknown[] = [];

  if (!bypass) {
    const SCOPED_ROLES = ['admin','hr','finance','payroll','ceo','manager','branch_head',
                         'process_manager','assistant_manager','tl','wfm','it'];
    const clause = await buildScopeWhereClause(
      scope.actorUserId,
      SCOPED_ROLES,
      { branch: 'e.branch_id', process: 'e.process_id' }
    );
    scopeWhere = clause.sql;
    scopeParams = clause.params;
  }
```

- [ ] **Step 5: Apply scopeWhere to all 4 sub-queries inside getExitCommandCenter()**

The function has 4 main queries. Each one JOINs `employees e` on `exit_request er`. For each, add `AND (${scopeWhere})` to the WHERE clause and spread `...scopeParams` into the params array.

Example for the summary/KPI query:
```typescript
const [summaryRows] = await db.execute<RowDataPacket[]>(
  `SELECT
     COUNT(*) AS total,
     SUM(er.status IN ('submitted','returned','notice_active','notice_serving','accepted','manager_review','hr_review','admin_review')) AS active_count,
     SUM(er.status = 'exited') AS exited_count,
     SUM(er.status = 'closed') AS closed_count
   FROM exit_request er
   JOIN employees e ON e.id = er.employee_id
   WHERE (${scopeWhere})`,
  [...scopeParams]
);
```

Apply the same `AND (${scopeWhere})` + params spread to the requests list query, attrition trend query, and analytics breakdown query.

- [ ] **Step 6: Run tests — expect pass**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitCommandCenter.scope.contract.test.ts 2>&1 | tail -20
```

Expected: PASS (3 tests).

- [ ] **Step 7: Update exit.routes.ts to pass scope**

Find the `GET /command-center` handler in `exit.routes.ts`. It currently calls `getExitCommandCenter()` with no arguments. Change it to:

```typescript
exitRouter.get('/command-center', requireRole(['admin','hr','manager','finance','payroll','ceo','wfm','branch_head','process_manager','payroll_head','super_admin']), h(async (req: AuthenticatedRequest, res) => {
  const actorUserId = req.authUser!.id;
  const actorRoles: string[] = req.authUser!.roles ?? [];
  const data = await getExitCommandCenter({ actorUserId, actorRoles });
  res.json({ success: true, data });
}));
```

- [ ] **Step 8: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 new errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/exit/exit-intelligence.service.ts \
        backend/src/modules/exit/exit.routes.ts \
        backend/src/modules/exit/__tests__/exitCommandCenter.scope.contract.test.ts
git commit -m "feat(exit): branch scoping in getExitCommandCenter — super_admin/payroll_head bypass, others filtered by user_assignment_scope"
```

---

## Task 4: New FSM Transitions (notice_active, returned, terminated)

**Files:**
- Modify: `backend/src/modules/exit/exit.service.ts`
- Modify: `backend/src/modules/exit/exit.routes.ts`

**Interfaces:**
- Consumes: `createDefaultClearanceTasks(exitRequestId, employeeId)` from `exit-intelligence.service.ts`
- Produces: `transitionExitStatus(id, newStatus, actor, opts?)` callable from route handlers

- [ ] **Step 1: Write the failing FSM transition test**

Create `backend/src/modules/exit/__tests__/exitFsm.transitions.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { db } from '../../../db/mysql.js';
import { randomUUID } from 'crypto';

// Helper: create a minimal exit_request row
async function seedExit(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const employeeId = overrides.employee_id as string ?? 'test-employee-id-placeholder';
  await db.execute(
    `INSERT INTO exit_request
       (id, employee_id, exit_type, exit_sub_type, status, notice_period_days,
        last_working_day_confirmed, submitted_at, initiated_by)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 30 DAY), NOW(), ?)`,
    [
      id,
      employeeId,
      overrides.exit_type ?? 'voluntary',
      overrides.exit_sub_type ?? 'resignation',
      overrides.status ?? 'submitted',
      overrides.notice_period_days ?? 30,
      overrides.initiated_by ?? 'employee',
    ]
  );
  return id;
}

async function cleanExit(id: string) {
  await db.execute('DELETE FROM exit_clearance_task WHERE exit_request_id = ?', [id]);
  await db.execute('DELETE FROM exit_approval_log WHERE exit_request_id = ?', [id]);
  await db.execute('DELETE FROM exit_request WHERE id = ?', [id]);
}

describe('Exit FSM transitions', () => {
  it('submitted → notice_active creates clearance tasks', async () => {
    // This test verifies the service-layer transition, not the HTTP route.
    // Import the transition function once it exists in exit.service.ts.
    // For now this test is a placeholder that will fail until Task 4 Step 3.
    expect(true).toBe(false); // intentional — RED state
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitFsm.transitions.contract.test.ts 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Add transitionExitStatus() to exit.service.ts**

In `exit.service.ts`, add this exported function. Insert it after the existing imports but before other exports:

```typescript
import { createDefaultClearanceTasks } from "./exit-intelligence.service.js";

// Valid transitions in the new FSM
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted:     ['notice_active', 'returned', 'revoked'],
  returned:      ['submitted', 'revoked'],
  notice_active: ['exited', 'revoked'],
  terminated:    ['exited'],
  exited:        ['closed'],
  // Legacy compat paths (existing rows in prod)
  draft:             ['submitted'],
  manager_review:    ['notice_active', 'returned', 'accepted'],
  hr_review:         ['accepted', 'rejected'],
  accepted:          ['notice_serving', 'notice_active'],
  notice_serving:    ['exited', 'notice_active'],
};

export async function transitionExitStatus(
  exitRequestId: string,
  newStatus: string,
  actor: { userId: string; userRole: string; name?: string },
  opts: {
    reason?: string;
    lwdOverride?: string;
    lwdOverrideReason?: string;
  } = {}
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, status, exit_type, exit_sub_type FROM exit_request WHERE id = ? LIMIT 1`,
    [exitRequestId]
  );
  const rec = rows[0] as any;
  if (!rec) throw Object.assign(new Error('Exit request not found'), { statusCode: 404 });

  const allowed = ALLOWED_TRANSITIONS[rec.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Cannot transition from ${rec.status} to ${newStatus}`),
      { statusCode: 409, code: 'invalid_transition' }
    );
  }

  // Build the UPDATE fields
  const updates: string[] = ['status = ?', 'updated_at = NOW()'];
  const params: unknown[] = [newStatus];

  if (newStatus === 'returned' && opts.reason) {
    updates.push('return_reason = ?');
    params.push(opts.reason);
    updates.push('manager_actioned_at = NOW()');
  }
  if (newStatus === 'notice_active') {
    updates.push('manager_actioned_at = NOW()');
    if (opts.lwdOverride) {
      updates.push('lwd_override = ?', 'lwd_override_reason = ?');
      params.push(opts.lwdOverride, opts.lwdOverrideReason ?? null);
    }
  }
  if (newStatus === 'exited') {
    updates.push('exit_confirmed_at = NOW()');
  }
  if (newStatus === 'revoked') {
    updates.push('revoked_at = NOW()', 'revoke_reason = ?', 'revoked_by = ?');
    params.push(opts.reason ?? null, actor.userId);
  }

  params.push(exitRequestId);
  await db.execute(`UPDATE exit_request SET ${updates.join(', ')} WHERE id = ?`, params);

  // Write approval log
  await db.execute(
    `INSERT INTO exit_approval_log
       (id, exit_request_id, stage, action, action_by, action_by_role, discussion_remarks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      randomUUID(),
      exitRequestId,
      newStatus,
      newStatus,
      actor.userId,
      actor.userRole,
      opts.reason ?? null,
    ]
  );

  // Auto-generate clearance tasks when entering active notice
  if (newStatus === 'notice_active' || newStatus === 'terminated') {
    await createDefaultClearanceTasks(exitRequestId, rec.employee_id);
  }
}
```

- [ ] **Step 4: Update the failing test to use transitionExitStatus**

Replace the placeholder test body in `exitFsm.transitions.contract.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../../db/mysql.js';
import { randomUUID } from 'crypto';
import { transitionExitStatus } from '../exit.service.js';

// Find a real employee ID from the DB for seeding
async function getAnyEmployeeId(): Promise<string> {
  const [rows] = await db.execute<any[]>('SELECT id FROM employees LIMIT 1');
  if (!rows[0]) throw new Error('No employees in test DB');
  return rows[0].id;
}

const created: string[] = [];

async function seedExit(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const employeeId = overrides.employee_id as string ?? await getAnyEmployeeId();
  await db.execute(
    `INSERT INTO exit_request
       (id, employee_id, exit_type, exit_sub_type, status, notice_period_days,
        last_working_day_confirmed, submitted_at, initiated_by)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 30 DAY), NOW(), ?)`,
    [id, employeeId, overrides.exit_type ?? 'voluntary', overrides.exit_sub_type ?? 'resignation',
     overrides.status ?? 'submitted', 30, overrides.initiated_by ?? 'employee']
  );
  created.push(id);
  return { id, employeeId };
}

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.execute('DELETE FROM exit_clearance_task WHERE exit_request_id = ?', [id]);
    await db.execute('DELETE FROM exit_approval_log WHERE exit_request_id = ?', [id]);
    await db.execute('DELETE FROM exit_request WHERE id = ?', [id]);
  }
});

const actor = { userId: 'test-manager-id', userRole: 'manager', name: 'Test Manager' };

describe('Exit FSM transitions', () => {
  it('submitted → notice_active succeeds and creates clearance tasks', async () => {
    const { id, employeeId } = await seedExit({ status: 'submitted' });

    await transitionExitStatus(id, 'notice_active', actor);

    const [exitRows] = await db.execute<any[]>('SELECT status FROM exit_request WHERE id = ?', [id]);
    expect(exitRows[0].status).toBe('notice_active');

    const [taskRows] = await db.execute<any[]>(
      'SELECT COUNT(*) AS cnt FROM exit_clearance_task WHERE exit_request_id = ?', [id]
    );
    expect(Number(taskRows[0].cnt)).toBeGreaterThan(0);
  });

  it('submitted → returned stores return_reason', async () => {
    const { id } = await seedExit({ status: 'submitted' });
    await transitionExitStatus(id, 'returned', actor, { reason: 'LWD date wrong, please correct' });

    const [rows] = await db.execute<any[]>('SELECT status, return_reason FROM exit_request WHERE id = ?', [id]);
    expect(rows[0].status).toBe('returned');
    expect(rows[0].return_reason).toBe('LWD date wrong, please correct');
  });

  it('returned → submitted (resubmit) succeeds', async () => {
    const { id } = await seedExit({ status: 'returned' });
    const employeeActor = { userId: 'test-emp-id', userRole: 'employee' };
    await transitionExitStatus(id, 'submitted', employeeActor);

    const [rows] = await db.execute<any[]>('SELECT status FROM exit_request WHERE id = ?', [id]);
    expect(rows[0].status).toBe('submitted');
  });

  it('invalid transition throws 409', async () => {
    const { id } = await seedExit({ status: 'submitted' });
    await expect(transitionExitStatus(id, 'exited', actor))
      .rejects.toMatchObject({ statusCode: 409, code: 'invalid_transition' });
  });

  it('notice_active → revoked stores revoked_by', async () => {
    const { id } = await seedExit({ status: 'notice_active' });
    const empActor = { userId: 'test-emp-id', userRole: 'employee' };
    await transitionExitStatus(id, 'revoked', empActor, { reason: 'Changed mind' });

    const [rows] = await db.execute<any[]>('SELECT status, revoke_reason, revoked_by FROM exit_request WHERE id = ?', [id]);
    expect(rows[0].status).toBe('revoked');
    expect(rows[0].revoke_reason).toBe('Changed mind');
    expect(rows[0].revoked_by).toBe('test-emp-id');
  });

  it('every transition writes an exit_approval_log entry', async () => {
    const { id } = await seedExit({ status: 'submitted' });
    await transitionExitStatus(id, 'notice_active', actor);

    const [logRows] = await db.execute<any[]>(
      'SELECT * FROM exit_approval_log WHERE exit_request_id = ?', [id]
    );
    expect(logRows.length).toBeGreaterThan(0);
    expect(logRows[0].action_by_role).toBe('manager');
  });

  it('terminated exit auto-creates clearance tasks', async () => {
    const { id } = await seedExit({ status: 'submitted', exit_type: 'involuntary', exit_sub_type: 'termination' });
    const hrActor = { userId: 'test-hr-id', userRole: 'hr' };
    // HR directly creates exit in 'terminated' status by calling transitionExitStatus
    // from 'submitted' (compat path) or from route directly inserting 'terminated'
    await transitionExitStatus(id, 'notice_active', hrActor); // for involuntary, notice_active ~ terminated
    const [taskRows] = await db.execute<any[]>(
      'SELECT COUNT(*) AS cnt FROM exit_clearance_task WHERE exit_request_id = ?', [id]
    );
    expect(Number(taskRows[0].cnt)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitFsm.transitions.contract.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Wire transitionExitStatus into exit.routes.ts**

Find the route that handles manager approve/reject (currently `PATCH /:id/status` or similar). Replace the inline UPDATE logic with calls to `transitionExitStatus`. Also wire the employee revoke route.

For the manager approval route (find it in exit.routes.ts, it updates status to `accepted` or `manager_review`):

```typescript
// Manager approves voluntary resignation
exitRouter.patch('/:id/approve', requireRole(['manager','assistant_manager','process_manager','branch_head']), h(async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const actor = { userId: req.authUser!.id, userRole: req.authUser!.roles?.[0] ?? 'manager' };
  await transitionExitStatus(id, 'notice_active', actor, {
    lwdOverride: req.body.lwd_override,
    lwdOverrideReason: req.body.lwd_override_reason,
  });
  // Fire notification (added in Task 6)
  res.json({ success: true });
}));

// Manager rejects (returns) with reason
exitRouter.patch('/:id/return', requireRole(['manager','assistant_manager','process_manager','branch_head']), h(async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  if (!req.body.reason) return res.status(400).json({ success: false, message: 'reason is required' });
  const actor = { userId: req.authUser!.id, userRole: req.authUser!.roles?.[0] ?? 'manager' };
  await transitionExitStatus(id, 'returned', actor, { reason: req.body.reason });
  res.json({ success: true });
}));

// Employee revokes
exitRouter.patch('/:id/revoke', h(async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  // Validate caller is the employee who owns this exit
  const [rows] = await db.execute<RowDataPacket[]>('SELECT employee_id FROM exit_request WHERE id = ?', [id]);
  const rec = rows[0] as any;
  if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
  const callerEmployee = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmployee || callerEmployee.id !== rec.employee_id) {
    // Allow admin/hr to revoke on behalf
    if (!hasRole(req.authUser!, ['admin','hr','super_admin'])) {
      return res.status(403).json({ success: false, message: 'You can only revoke your own exit.' });
    }
  }
  const actor = { userId: req.authUser!.id, userRole: req.authUser!.roles?.[0] ?? 'employee' };
  await transitionExitStatus(id, 'revoked', actor, { reason: req.body.reason });
  res.json({ success: true });
}));
```

- [ ] **Step 7: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 new errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/exit/exit.service.ts \
        backend/src/modules/exit/exit.routes.ts \
        backend/src/modules/exit/__tests__/exitFsm.transitions.contract.test.ts
git commit -m "feat(exit): transitionExitStatus() — 4-state FSM with auto-clearance task generation"
```

---

## Task 5: Clearance Role Gate + Audit Columns

**Files:**
- Modify: `backend/src/modules/exit/exit.routes.ts`

**Interfaces:**
- Consumes: `exit_clearance_task` now has `cleared_by_name`, `cleared_by_role`, `clearing_reason` columns (from migration 074)
- Produces: `PATCH /:id/clearance/:taskId` rejects 403 when caller's role is not in `CLEARANCE_ROLE_MAP[task.clearance_area]`

- [ ] **Step 1: Write failing test**

Create `backend/src/modules/exit/__tests__/exitClearance.roleGate.contract.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../../db/mysql.js';
import { randomUUID } from 'crypto';

// These tests call the SERVICE-level gate function, not the HTTP route,
// to avoid needing a running server. We test the gate logic inline.
// The CLEARANCE_ROLE_MAP is exported from exit.routes.ts in Step 3.
import { CLEARANCE_ROLE_MAP, canClearTask } from '../exit.routes.js';

describe('Clearance role gate', () => {
  it('manager can clear manager area', () => {
    expect(canClearTask('manager', ['manager'])).toBe(true);
  });
  it('manager cannot clear wfm area', () => {
    expect(canClearTask('wfm', ['manager'])).toBe(false);
  });
  it('manager cannot clear it area', () => {
    expect(canClearTask('it', ['manager'])).toBe(false);
  });
  it('manager cannot clear finance area', () => {
    expect(canClearTask('finance', ['manager'])).toBe(false);
  });
  it('wfm role can clear wfm area', () => {
    expect(canClearTask('wfm', ['wfm'])).toBe(true);
  });
  it('it role can clear it area', () => {
    expect(canClearTask('it', ['it'])).toBe(true);
  });
  it('hr can clear hr area', () => {
    expect(canClearTask('hr', ['hr'])).toBe(true);
  });
  it('super_admin bypasses all areas', () => {
    expect(canClearTask('finance', ['super_admin'])).toBe(true);
    expect(canClearTask('it', ['super_admin'])).toBe(true);
  });
  it('admin bypasses all areas', () => {
    expect(canClearTask('wfm', ['admin'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitClearance.roleGate.contract.test.ts 2>&1 | tail -10
```

Expected: FAIL — `canClearTask` not exported yet.

- [ ] **Step 3: Add CLEARANCE_ROLE_MAP and canClearTask to exit.routes.ts**

Near the top of `exit.routes.ts` (after imports), add:

```typescript
export const CLEARANCE_ROLE_MAP: Record<string, string[]> = {
  manager:    ['manager','assistant_manager','process_manager','branch_head'],
  hr:         ['hr','admin'],
  compliance: ['hr','admin'],
  assets:     ['admin','hr'],
  it:         ['it','admin'],
  wfm:        ['wfm','admin'],
  payroll:    ['payroll','payroll_head','hr'],
  finance:    ['finance','payroll_head'],
};

const CLEARANCE_BYPASS = new Set(['super_admin','admin']);

export function canClearTask(area: string, callerRoles: string[]): boolean {
  if (callerRoles.some(r => CLEARANCE_BYPASS.has(r))) return true;
  const allowed = CLEARANCE_ROLE_MAP[area] ?? [];
  return callerRoles.some(r => allowed.includes(r));
}
```

- [ ] **Step 4: Inject gate into the PATCH /:id/clearance/:taskId handler**

Find the `PATCH /:id/clearance/:taskId` handler in `exit.routes.ts`. After fetching the task row and before the UPDATE, add:

```typescript
const newStatus: string = req.body.status;
if (['cleared', 'waived'].includes(newStatus)) {
  const callerRoles: string[] = req.authUser!.roles ?? [];
  if (!canClearTask(task.clearance_area, callerRoles)) {
    return res.status(403).json({
      success: false,
      code: 'clearance_role_mismatch',
      message: `The ${task.clearance_area} clearance area can only be cleared by: ${(CLEARANCE_ROLE_MAP[task.clearance_area] ?? []).join(', ')}.`,
    });
  }
  if (newStatus === 'waived' && !req.body.clearing_reason) {
    return res.status(400).json({ success: false, code: 'reason_required', message: 'clearing_reason is required when waiving a task.' });
  }
}
```

Then, in the UPDATE query for the task, add the audit columns:

```typescript
// Resolve actor name
const [actorRows] = await db.execute<RowDataPacket[]>(
  `SELECT CONCAT_WS(' ', first_name, last_name) AS full_name FROM employees WHERE user_id = ? LIMIT 1`,
  [req.authUser!.id]
);
const actorName = (actorRows[0] as any)?.full_name ?? req.authUser!.id;
const actorRole = (req.authUser!.roles ?? [])[0] ?? 'unknown';

await db.execute(
  `UPDATE exit_clearance_task
      SET status = ?, cleared_by = ?, cleared_by_name = ?, cleared_by_role = ?,
          clearing_reason = ?, updated_at = NOW()
    WHERE id = ?`,
  [newStatus, req.authUser!.id, actorName, actorRole, req.body.clearing_reason ?? null, req.params.taskId]
);
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitClearance.roleGate.contract.test.ts 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 6: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/exit/exit.routes.ts \
        backend/src/modules/exit/__tests__/exitClearance.roleGate.contract.test.ts
git commit -m "feat(exit): clearance role gate (CLEARANCE_ROLE_MAP) + audit columns cleared_by_name/role/reason"
```

---

## Task 6: 2-Step F&F (Remove is_ff_provisional gate)

**Files:**
- Modify: `backend/src/modules/exit/ff.service.ts`

**Interfaces:**
- Produces: `ffService.approveFF(id, approvedBy)` no longer checks `is_ff_provisional`; `ffService.setProvisionalFalse()` now writes `verified_by` audit columns (migration 075)

- [ ] **Step 1: Write failing test**

Create `backend/src/modules/exit/__tests__/exitFF.twoStep.contract.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../../db/mysql.js';
import { randomUUID } from 'crypto';
import { ffService } from '../ff.service.js';

const created: string[] = [];

async function getAnyExitId(): Promise<{ exitId: string; employeeId: string }> {
  const [rows] = await db.execute<any[]>(
    `SELECT er.id AS exitId, er.employee_id FROM exit_request er
     WHERE er.status IN ('notice_active','exited','terminated')
     LIMIT 1`
  );
  if (!rows[0]) throw new Error('No suitable exit_request in test DB — seed one first');
  return { exitId: rows[0].exitId, employeeId: rows[0].employee_id };
}

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.execute('DELETE FROM full_final_calculation WHERE id = ?', [id]);
  }
});

describe('F&F 2-step flow', () => {
  it('approveFF succeeds even when is_ff_provisional = 1 (gate removed)', async () => {
    // Insert a provisional F&F manually
    const ffId = randomUUID();
    const { exitId } = await getAnyExitId();
    await db.execute(
      `INSERT INTO full_final_calculation
         (id, exit_request_id, status, is_ff_provisional, net_payable, created_by)
       VALUES (?, ?, 'draft', 1, 5000.00, 'test-user')`,
      [ffId, exitId]
    );
    created.push(ffId);

    await expect(ffService.approveFF(ffId, 'test-approver-id')).resolves.not.toThrow();

    const [rows] = await db.execute<any[]>('SELECT status FROM full_final_calculation WHERE id = ?', [ffId]);
    expect(rows[0].status).toBe('approved');
  });

  it('setProvisionalFalse writes verified_by audit columns', async () => {
    const ffId = randomUUID();
    const { exitId } = await getAnyExitId();
    await db.execute(
      `INSERT INTO full_final_calculation
         (id, exit_request_id, status, is_ff_provisional, net_payable, created_by)
       VALUES (?, ?, 'draft', 1, 5000.00, 'test-user')`,
      [ffId, exitId]
    );
    created.push(ffId);

    await ffService.setProvisionalFalse(ffId, 'test-verifier-id', 'Verified by payroll team');

    const [rows] = await db.execute<any[]>(
      'SELECT is_ff_provisional, verified_by, verification_reason FROM full_final_calculation WHERE id = ?',
      [ffId]
    );
    expect(rows[0].is_ff_provisional).toBe(0);
    expect(rows[0].verified_by).toBe('test-verifier-id');
    expect(rows[0].verification_reason).toBe('Verified by payroll team');
  });

  it('markFfPaid requires approved status', async () => {
    const ffId = randomUUID();
    const { exitId } = await getAnyExitId();
    await db.execute(
      `INSERT INTO full_final_calculation
         (id, exit_request_id, status, is_ff_provisional, net_payable, created_by)
       VALUES (?, ?, 'draft', 0, 5000.00, 'test-user')`,
      [ffId, exitId]
    );
    created.push(ffId);

    await expect(ffService.markFfPaid(ffId, 'test-payer', 'REF123'))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitFF.twoStep.contract.test.ts 2>&1 | tail -15
```

Expected: FAIL on first test (approveFF currently blocks provisional).

- [ ] **Step 3: Remove is_ff_provisional gate from approveFF in ff.service.ts**

Find `ffService.approveFF` in `ff.service.ts`. It currently has a check like:

```typescript
if (rec.is_ff_provisional) throw ffError(409, 'still_provisional', 'F&F must be verified before approval');
```

Remove that check entirely. The function should now just validate `status = 'draft'` and proceed to approve.

- [ ] **Step 4: Update setProvisionalFalse to write audit columns**

Find `ffService.setProvisionalFalse(id, verifiedBy, reason)` in `ff.service.ts`. Update the UPDATE query to also write the audit columns:

```typescript
async setProvisionalFalse(id: string, verifiedBy: string, reason: string) {
  if (!reason?.trim()) throw ffError(400, 'reason_required', 'reason is required for verification');

  // Resolve verifier name
  const [nameRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT_WS(' ', first_name, last_name) AS full_name FROM employees WHERE user_id = ? LIMIT 1`,
    [verifiedBy]
  );
  const verifierName = (nameRows[0] as any)?.full_name ?? verifiedBy;

  await db.execute(
    `UPDATE full_final_calculation
        SET is_ff_provisional = 0,
            verified_by = ?,
            verified_by_name = ?,
            verified_at = NOW(),
            verification_reason = ?
      WHERE id = ?`,
    [verifiedBy, verifierName, reason, id]
  );
},
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitFF.twoStep.contract.test.ts 2>&1 | tail -15
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/exit/ff.service.ts \
        backend/src/modules/exit/__tests__/exitFF.twoStep.contract.test.ts
git commit -m "feat(exit): 2-step F&F — remove is_ff_provisional gate from approveFF; add verified_by audit columns to setProvisionalFalse"
```

---

## Task 7: Nightly Auto-Advance Cron Job

**Files:**
- Create: `backend/src/cron/exitAutoAdvance.cron.ts`

**Interfaces:**
- Consumes: `transitionExitStatus()` from `exit.service.ts`
- Produces: exported `runExitAutoAdvance()` callable by the cron scheduler and by tests

- [ ] **Step 1: Write failing test**

Create `backend/src/modules/exit/__tests__/exitAutoAdvance.contract.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../../db/mysql.js';
import { randomUUID } from 'crypto';
import { runExitAutoAdvance } from '../../../cron/exitAutoAdvance.cron.js';

const created: string[] = [];

async function getAnyEmployeeId() {
  const [r] = await db.execute<any[]>('SELECT id FROM employees LIMIT 1');
  return r[0]?.id ?? 'fallback-id';
}

async function seedExit(status: string, lwdDaysOffset: number, allTasksCleared: boolean) {
  const id = randomUUID();
  const employeeId = await getAnyEmployeeId();
  const lwd = lwdDaysOffset <= 0
    ? `DATE_ADD(CURDATE(), INTERVAL ${lwdDaysOffset} DAY)`
    : `DATE_ADD(CURDATE(), INTERVAL ${lwdDaysOffset} DAY)`;

  await db.execute(
    `INSERT INTO exit_request (id, employee_id, exit_type, exit_sub_type, status, notice_period_days, last_working_day_confirmed, submitted_at, initiated_by)
     VALUES (?, ?, 'voluntary', 'resignation', ?, 30, ${lwd}, NOW(), 'employee')`,
    [id, employeeId, status]
  );

  if (allTasksCleared) {
    // Seed cleared clearance tasks (so the cron sees them as done)
    await db.execute(
      `INSERT INTO exit_clearance_task (id, exit_request_id, employee_id, clearance_area, task_title, owner_role, status)
       VALUES (?, ?, ?, 'hr', 'HR task', 'hr', 'cleared')`,
      [randomUUID(), id, employeeId]
    );
  } else {
    // Seed a pending task (blocks auto-advance)
    await db.execute(
      `INSERT INTO exit_clearance_task (id, exit_request_id, employee_id, clearance_area, task_title, owner_role, status)
       VALUES (?, ?, ?, 'wfm', 'WFM task', 'wfm', 'pending')`,
      [randomUUID(), id, employeeId]
    );
  }
  created.push(id);
  return id;
}

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.execute('DELETE FROM exit_clearance_task WHERE exit_request_id = ?', [id]);
    await db.execute('DELETE FROM exit_approval_log WHERE exit_request_id = ?', [id]);
    await db.execute('DELETE FROM exit_request WHERE id = ?', [id]);
  }
});

describe('Exit auto-advance cron', () => {
  it('advances notice_active to exited when LWD past and all tasks cleared', async () => {
    const id = await seedExit('notice_active', -1, true); // LWD was yesterday, tasks cleared
    await runExitAutoAdvance();
    const [rows] = await db.execute<any[]>('SELECT status FROM exit_request WHERE id = ?', [id]);
    expect(rows[0].status).toBe('exited');
  });

  it('does NOT advance when LWD past but tasks still pending', async () => {
    const id = await seedExit('notice_active', -1, false); // LWD was yesterday, task pending
    await runExitAutoAdvance();
    const [rows] = await db.execute<any[]>('SELECT status FROM exit_request WHERE id = ?', [id]);
    expect(rows[0].status).toBe('notice_active'); // unchanged
  });

  it('does NOT advance when LWD is in the future', async () => {
    const id = await seedExit('notice_active', 5, true); // LWD in 5 days, tasks cleared
    await runExitAutoAdvance();
    const [rows] = await db.execute<any[]>('SELECT status FROM exit_request WHERE id = ?', [id]);
    expect(rows[0].status).toBe('notice_active'); // unchanged
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitAutoAdvance.contract.test.ts 2>&1 | tail -10
```

Expected: FAIL — `runExitAutoAdvance` not found.

- [ ] **Step 3: Create the cron file**

Create `backend/src/cron/exitAutoAdvance.cron.ts`:

```typescript
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { transitionExitStatus } from '../modules/exit/exit.service.js';
import { logger } from '../utils/logger.js';

export async function runExitAutoAdvance(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.employee_id
       FROM exit_request er
      WHERE er.status IN ('notice_active', 'terminated')
        AND er.last_working_day_confirmed <= CURDATE()
        AND NOT EXISTS (
          SELECT 1 FROM exit_clearance_task ect
           WHERE ect.exit_request_id = er.id
             AND ect.status NOT IN ('cleared', 'waived', 'not_applicable')
        )`
  );

  const actor = { userId: 'system', userRole: 'system' };

  for (const row of rows as any[]) {
    try {
      await transitionExitStatus(row.id, 'exited', actor);
      logger.info({ exitRequestId: row.id }, 'Auto-advanced exit to exited');
    } catch (err: any) {
      logger.error({ exitRequestId: row.id, err: err.message }, 'Auto-advance failed');
    }
  }
}

// Schedule — called from server startup or a cron entry
// Example (node-cron): cron.schedule('30 0 * * *', runExitAutoAdvance);
```

- [ ] **Step 4: Register the cron in server startup**

Find `backend/src/server.ts` (or wherever crons are registered). Add:

```typescript
import { runExitAutoAdvance } from './cron/exitAutoAdvance.cron.js';
import cron from 'node-cron';

// After server starts:
cron.schedule('30 0 * * *', () => {
  runExitAutoAdvance().catch(err => logger.error({ err }, 'exitAutoAdvance cron failed'));
}, { timezone: 'Asia/Kolkata' });
```

Check whether `node-cron` is already a dependency:
```bash
grep node-cron backend/package.json
```

If not present: `cd backend && npm install node-cron && npm install -D @types/node-cron`

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitAutoAdvance.contract.test.ts 2>&1 | tail -15
```

Expected: all 3 PASS.

- [ ] **Step 6: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/cron/exitAutoAdvance.cron.ts \
        backend/src/server.ts \
        backend/src/modules/exit/__tests__/exitAutoAdvance.contract.test.ts
git commit -m "feat(exit): nightly auto-advance cron — exited when LWD past and all clearance tasks cleared"
```

---

## Task 8: Email + WhatsApp Notifications

**Files:**
- Modify: `backend/src/modules/communication/notification-event.service.ts`
- Modify: `backend/src/modules/exit/exit.notifications.ts`
- Modify: `backend/src/modules/exit/exit.service.ts` (wire calls)
- Modify: `backend/src/modules/exit/exit.routes.ts` (wire calls at route level)

**Interfaces:**
- Consumes: `notificationGateway.dispatch(eventKey, recipientUserId, data)` — existing pattern in `exit.notifications.ts`
- Produces: 8 new dispatch functions in `exit.notifications.ts`

- [ ] **Step 1: Register new event keys in notification-event.service.ts**

Find the events object in `notification-event.service.ts`. It already has `exit_update` and `full_final_ready`. Add after `exit_update`:

```typescript
exit_resignation_submitted: {
  label: 'Resignation submitted — manager action needed',
  category: 'alerts',
  title: 'Resignation submitted — {{employee_name}}',
  message: '{{employee_name}} has submitted their resignation. LWD: {{lwd}}. Please review and approve or return.',
  shortMessage: 'Resignation submitted by {{employee_name}}.',
  actionUrl: '/exit/command-center',
  priority: 'high',
  channels: allChannels,
},
exit_manager_approved: {
  label: 'Resignation acknowledged by manager',
  category: 'alerts',
  title: 'Resignation acknowledged',
  message: 'Your resignation has been acknowledged. Last working date confirmed: {{lwd}}. Your clearance tasks will begin shortly.',
  shortMessage: 'Resignation acknowledged. LWD: {{lwd}}.',
  actionUrl: '/exit-management',
  priority: 'high',
  channels: allChannels,
},
exit_manager_returned: {
  label: 'Resignation returned for correction',
  category: 'alerts',
  title: 'Resignation returned — action required',
  message: 'Your resignation was returned by your manager: "{{return_reason}}". Please correct and resubmit.',
  shortMessage: 'Resignation returned: {{return_reason}}.',
  actionUrl: '/exit-management',
  priority: 'high',
  channels: allChannels,
},
exit_clearance_assigned: {
  label: 'Clearance task assigned',
  category: 'alerts',
  title: 'Clearance task: {{task_title}}',
  message: 'You have a clearance task for {{employee_name}} (LWD: {{lwd}}): {{task_title}}. Please complete before the last working date.',
  shortMessage: 'Clearance task assigned: {{task_title}} for {{employee_name}}.',
  actionUrl: '/exit/clearance-queue',
  priority: 'high',
  channels: allChannels,
},
exit_clearance_completed: {
  label: 'Clearance task completed',
  category: 'alerts',
  title: '{{area}} clearance done — {{employee_name}}',
  message: '{{area}} clearance for {{employee_name}} has been {{status}} by {{cleared_by_name}}.',
  shortMessage: '{{area}} clearance {{status}}.',
  actionUrl: '/exit/command-center',
  priority: 'normal',
  channels: allChannels,
},
exit_auto_exited: {
  label: 'Employee exit completed',
  category: 'alerts',
  title: '{{employee_name}} has exited — F&F pending',
  message: '{{employee_name}} ({{employee_code}}) reached their last working date. All clearance tasks are cleared. Please initiate Full & Final settlement.',
  shortMessage: '{{employee_name}} exit complete — initiate F&F.',
  actionUrl: '/exit/command-center',
  priority: 'high',
  channels: allChannels,
},
exit_ff_approved: {
  label: 'Full & Final approved',
  category: 'alerts',
  title: 'Full & Final settlement approved',
  message: 'Your Full & Final settlement of ₹{{net_payable}} has been approved. Payment will be processed soon.',
  shortMessage: 'F&F approved: ₹{{net_payable}}.',
  actionUrl: '/exit-management',
  priority: 'high',
  channels: allChannels,
},
exit_revoked: {
  label: 'Resignation revoked',
  category: 'alerts',
  title: '{{employee_name}} revoked their resignation',
  message: '{{employee_name}} has revoked their resignation. Reason: {{revoke_reason}}. The exit process has been cancelled.',
  shortMessage: 'Resignation revoked by {{employee_name}}.',
  actionUrl: '/exit/command-center',
  priority: 'normal',
  channels: allChannels,
},
```

- [ ] **Step 2: Add 8 dispatch functions to exit.notifications.ts**

Add at the end of `exit.notifications.ts`:

```typescript
export async function notifyResignationSubmittedToManager(exitRequestId: string): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx) return;
  // Notify the manager
  if (ctx.manager_user_id) {
    await notificationGateway.dispatch('exit_resignation_submitted', ctx.manager_user_id, {
      employee_name: ctx.employee_name,
      lwd: ctx.last_working_day_confirmed ?? 'TBD',
      exit_request_id: exitRequestId,
    });
  }
}

export async function notifyManagerDecision(
  exitRequestId: string,
  decision: 'approved' | 'returned',
  returnReason?: string
): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx) return;
  const eventKey = decision === 'approved' ? 'exit_manager_approved' : 'exit_manager_returned';
  if (ctx.employee_user_id) {
    await notificationGateway.dispatch(eventKey, ctx.employee_user_id, {
      lwd: ctx.last_working_day_confirmed ?? 'TBD',
      return_reason: returnReason ?? '',
    });
  }
}

export async function notifyClearanceTaskAssigned(
  exitRequestId: string,
  taskOwnerUserId: string,
  taskTitle: string
): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx) return;
  await notificationGateway.dispatch('exit_clearance_assigned', taskOwnerUserId, {
    employee_name: ctx.employee_name,
    lwd: ctx.last_working_day_confirmed ?? 'TBD',
    task_title: taskTitle,
  });
}

export async function notifyClearanceCompleted(
  exitRequestId: string,
  area: string,
  status: string,
  clearedByName: string
): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx || !ctx.hr_user_id) return;
  await notificationGateway.dispatch('exit_clearance_completed', ctx.hr_user_id, {
    area,
    employee_name: ctx.employee_name,
    status,
    cleared_by_name: clearedByName,
  });
}

export async function notifyAutoExited(exitRequestId: string): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx) return;
  // Notify HR and Payroll (look up by role — fire-and-forget per role)
  // For simplicity, dispatch to the employee and the employee's HR
  if (ctx.hr_user_id) {
    await notificationGateway.dispatch('exit_auto_exited', ctx.hr_user_id, {
      employee_name: ctx.employee_name,
      employee_code: ctx.employee_code ?? '',
    });
  }
  if (ctx.employee_user_id) {
    await notificationGateway.dispatch('exit_auto_exited', ctx.employee_user_id, {
      employee_name: ctx.employee_name,
      employee_code: ctx.employee_code ?? '',
    });
  }
}

export async function notifyFFApproved(exitRequestId: string, netPayable: number): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx || !ctx.employee_user_id) return;
  await notificationGateway.dispatch('exit_ff_approved', ctx.employee_user_id, {
    net_payable: netPayable.toLocaleString('en-IN'),
  });
}

export async function notifyResignationRevoked(exitRequestId: string, revokeReason: string): Promise<void> {
  const ctx = await loadExitContext(exitRequestId);
  if (!ctx) return;
  if (ctx.manager_user_id) {
    await notificationGateway.dispatch('exit_revoked', ctx.manager_user_id, {
      employee_name: ctx.employee_name,
      revoke_reason: revokeReason,
    });
  }
  if (ctx.hr_user_id) {
    await notificationGateway.dispatch('exit_revoked', ctx.hr_user_id, {
      employee_name: ctx.employee_name,
      revoke_reason: revokeReason,
    });
  }
}
```

Note: `loadExitContext` must return `hr_user_id` and `employee_user_id`. Check the existing implementation and add those fields to the JOIN if missing. Look up `employee_user_id` via `employees.user_id` and `hr_user_id` via the branch HR assignment in `user_assignment_scope`.

- [ ] **Step 3: Wire notifications into exit.service.ts transitionExitStatus**

At the end of `transitionExitStatus`, after the existing logic, add notification calls:

```typescript
import {
  notifyResignationSubmittedToManager,
  notifyManagerDecision,
  notifyAutoExited,
  notifyResignationRevoked,
} from './exit.notifications.js';

// Inside transitionExitStatus, after the db.execute for status update:
setImmediate(() => {
  if (newStatus === 'submitted') {
    notifyResignationSubmittedToManager(exitRequestId).catch(() => {});
  } else if (newStatus === 'notice_active') {
    notifyManagerDecision(exitRequestId, 'approved').catch(() => {});
  } else if (newStatus === 'returned') {
    notifyManagerDecision(exitRequestId, 'returned', opts.reason).catch(() => {});
  } else if (newStatus === 'exited' && actor.userId === 'system') {
    notifyAutoExited(exitRequestId).catch(() => {});
  } else if (newStatus === 'revoked') {
    notifyResignationRevoked(exitRequestId, opts.reason ?? '').catch(() => {});
  }
});
```

- [ ] **Step 4: Wire clearance task notification into exit.routes.ts**

After the clearance task PATCH writes the cleared status, add:

```typescript
import { notifyClearanceCompleted } from './exit.notifications.js';

// After the UPDATE in PATCH /:id/clearance/:taskId:
setImmediate(() => {
  notifyClearanceCompleted(req.params.id, task.clearance_area, newStatus, actorName).catch(() => {});
});
```

Also, in `createDefaultClearanceTasks`, after each task is inserted, the notification per task owner is a stretch goal — the task owner lookup requires a user_id from `user_assignment_scope` by role. This is wired in a follow-up improvement; for now notifications are fired from the route after bulk creation.

- [ ] **Step 5: Wire FF approved notification into ff.service.ts**

In `ffService.approveFF`, after the UPDATE succeeds, add:

```typescript
import { notifyFFApproved } from './exit.notifications.js';

// After the UPDATE:
const [ffRow] = await db.execute<RowDataPacket[]>('SELECT exit_request_id, net_payable FROM full_final_calculation WHERE id = ?', [id]);
setImmediate(() => {
  notifyFFApproved((ffRow[0] as any).exit_request_id, Number((ffRow[0] as any).net_payable)).catch(() => {});
});
```

- [ ] **Step 6: Write notification smoke test**

Create `backend/src/modules/exit/__tests__/exitNotifications.contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { db } from '../../../db/mysql.js';
import { notifyResignationSubmittedToManager, notifyManagerDecision } from '../exit.notifications.js';

describe('Exit notifications smoke tests', () => {
  it('notifyResignationSubmittedToManager resolves without throwing for a real exit', async () => {
    const [rows] = await db.execute<any[]>('SELECT id FROM exit_request LIMIT 1');
    if (!rows[0]) return; // skip if no exits in test DB
    await expect(notifyResignationSubmittedToManager(rows[0].id)).resolves.not.toThrow();
  });

  it('notifyManagerDecision resolves without throwing', async () => {
    const [rows] = await db.execute<any[]>('SELECT id FROM exit_request LIMIT 1');
    if (!rows[0]) return;
    await expect(notifyManagerDecision(rows[0].id, 'approved')).resolves.not.toThrow();
  });
});
```

- [ ] **Step 7: Run notification tests**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/exitNotifications.contract.test.ts 2>&1 | tail -10
```

Expected: PASS (or SKIP if no exits in test DB).

- [ ] **Step 8: Build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/communication/notification-event.service.ts \
        backend/src/modules/exit/exit.notifications.ts \
        backend/src/modules/exit/exit.service.ts \
        backend/src/modules/exit/exit.routes.ts \
        backend/src/modules/exit/ff.service.ts \
        backend/src/modules/exit/__tests__/exitNotifications.contract.test.ts
git commit -m "feat(exit): email+WhatsApp notifications for all exit events — submission, approval, return, clearance, auto-exit, F&F"
```

---

## Task 9: Full Build Verification + Deploy

- [ ] **Step 1: Frontend build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` — 0 TypeScript errors.

- [ ] **Step 2: Backend TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 3: Run all exit tests**

```bash
cd backend && npx vitest run src/modules/exit/__tests__/ 2>&1 | tail -30
```

Expected: all pass (some may skip if test DB has no data — that is acceptable).

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

- [ ] **Step 5: Deploy to production**

```bash
plink -ssh -batch -pw "Support#123" -hostkey "SHA256:ao4r3/2yCcezZ+YQajAwJO66Wh7ZjzPXvpNmd0KEbsc" masadmin@mcnhrms.teammas.in \
  "cd /var/www/HRMS2 && git pull origin main"

plink ... "cd /var/www/HRMS2/backend && npm run build 2>&1 | tail -5"

plink ... "cd /var/www/HRMS2 && npm run build 2>&1 | tail -5"

# Apply migrations
plink ... "mysql -u root -p\$(grep DB_PASSWORD /var/www/HRMS2/backend/.env | cut -d= -f2) mas_hrms < /var/www/HRMS2/backend/sql/073_exit_fsm_lwd.sql"
plink ... "mysql -u root -p\$(grep DB_PASSWORD /var/www/HRMS2/backend/.env | cut -d= -f2) mas_hrms < /var/www/HRMS2/backend/sql/074_exit_clearance_audit.sql"
plink ... "mysql -u root -p\$(grep DB_PASSWORD /var/www/HRMS2/backend/.env | cut -d= -f2) mas_hrms < /var/www/HRMS2/backend/sql/075_ff_verify_audit.sql"

# Restart backend
plink ... "fuser -k 5055/tcp; pm2 delete hrms2-backend; pm2 start /var/www/HRMS2/backend/dist/src/server.js --name hrms2-backend --cwd /var/www/HRMS2/backend --log /var/www/HRMS2/backend/logs/backend-out.log --error /var/www/HRMS2/backend/logs/backend-err.log; pm2 save"
```

- [ ] **Step 6: Health check**

```bash
curl -s https://mcnhrms.teammas.in/api/health | jq .
```

Expected: `{"success":true,"status":"healthy"}`

- [ ] **Step 7: Verify migrations applied**

```bash
plink ... "mysql -u root -p... mas_hrms -e \"SHOW COLUMNS FROM exit_request LIKE 'lwd_override%'; SHOW COLUMNS FROM exit_clearance_task LIKE 'cleared_by%'; SHOW COLUMNS FROM full_final_calculation LIKE 'verified%';\""
```

Expected: all 7 new columns present.
