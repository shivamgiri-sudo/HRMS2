# Employee Rejoin v3 — Disciplinary Flag, Eligibility Endpoint, Post-Activation Follow-ups (Plan 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rejoin block real and make activation complete: (1) HR can set a disciplinary flag and only a super_admin can lift it, (2) the raise form can ask "is this person eligible?" live, (3) after the branch head approves, the things exit switched off are switched back on.

**Architecture:** Three small units. `rehireAccess.ts` holds the manager-scope check shared by two routes. `employee-governance.routes.ts` (an empty router stub today) gets the flag, lift and eligibility endpoints. `rejoinFollowUps.ts` runs the post-commit steps with injected dependencies so it is testable, and each step is isolated: one failure is recorded and reported, it never undoes the approval.

**Tech Stack:** TypeScript, Express, mysql2, zod, vitest + supertest.

**Plan series:** 1 core (done) → 2a dossier API (done) → 2b review UI (another session is working on it) → **3a this** → 3b notifications, reminders/escalation, ATS duplicate catch → 3c payroll split-month (flagged).

**Working directory:** worktree `/home/shuvam/hrms-rejoin-3` (branch `feat/rejoin-v3-flags`, branched from `feat/rejoin-v3`). `backend/node_modules` is symlinked. Run backend commands from `backend/`. Never push, never touch prod or any real database.

---

## What the research established (so this plan does not guess)

- `employee_rehire_control` (migration 2079) exists but **nothing writes it**. Until Task 2 the disciplinary block can never fire; only exit sub-type and reason can block.
- Exit (`exit.service.ts`) sets `employees.active_status=0` and a terminal `employment_status`, revokes refresh tokens, deactivates `lms_employee_mapping` (`is_active=0`), cancels future-dated leave, and raises IT delete tasks (`domain_delete`, `email_delete`, `biometric_delete`, `dialler_delete`). It does **not** block `auth_user`, change `user_roles`, zero the leave ledger, or reassign reportees.
- Login gate (`shared/accountStatus.ts`): revoked only if `auth_user.is_blocked=1` or `MAX(employees.active_status)=0`. So once `activateRejoin` sets `active_status=1` the old login works again with **no re-provisioning**. The auth-context cache has a 30s TTL; `invalidateAuthContextCache(userId)` (`middleware/authMiddleware.ts`) clears it immediately.
- `employee-activation.service.ts` `activateEmployee` returns `alreadyActive` once `active_status=1` and the nightly job selects only `active_status=0`; a rejoined row is never auto-provisioned. If `employees.user_id` is NULL there is no login to revive; the follow-up must flag that for HR instead of pretending.
- IT: `dispatchJoinProvisioningTasks({employeeId, employeeCode, employeeName, branchId, actorUserId, joiningDate?})` (`modules/it-provisioning/it-provisioning.service.ts`) re-raises email / biometric / dialer / domain tasks. It uses the pool, so it runs **after** commit.
- **Leave needs no action.** Exit never zeroes the ledger, and the rejoin gap is at most 30 days by rule, so balances stay as they were and the monthly catch-up (`leave-monthly-credit.worker.ts runCatchUp`) can credit at most about one month for the gap, consistent with continuous service. "Start fresh" would only apply to gaps over 30 days, which cannot rejoin through this flow (they go through ATS). This is a deliberate decision recorded here, not an omission.
- Reportees orphaned at exit are not restored (they may have been reassigned since). Out of scope.
- Audit helpers (`shared/auditLog.ts`): `logSensitiveAction({actor_user_id, action_type, module_key, entity_type, entity_id, employee_id, change_summary, old_value_json, new_value_json, reason, req})`, non-throwing, pool-based. Rejoin history table: `employee_reactivation_audit(request_id, action, actioned_by, remarks, metadata)`.
- `requireRole("super_admin")` really means super_admin only (`admin` is rejected). `requireRole("hr","admin","super_admin")` for HR actions.
- `employee-governance.routes.ts` is a 6-line stub (`export const employeeGovernanceRouter = Router();`) already mounted at `/api/employees` (`app.ts` ~line 645) with `listEndpointLimiter`.

## File Structure

| File | Responsibility |
|---|---|
| Create `backend/src/modules/employees/rehire/rehireAccess.ts` | `isFormerReport(db, employeeId, userId)` — the "a manager may act only for someone who reported to them" check |
| Modify `backend/src/modules/employees/employee-reactivation.routes.ts` | use `isFormerReport` in `initiate` (same SQL, behaviour unchanged); call follow-ups after commit in `branch-action` |
| Modify `backend/src/modules/employees/employee-governance.routes.ts` | `POST /:id/rehire-block/flag`, `POST /:id/rehire-block/lift`, `GET /:id/rehire-eligibility` |
| Create `backend/src/modules/employees/rehire/rejoinFollowUps.ts` | `runRejoinFollowUps(db, deps, input)` — isolated post-commit steps + audit |
| Create `backend/src/modules/employees/rehire/rejoinFollowUps.deps.ts` | `realFollowUpDeps` wiring the real auth-cache and IT-provisioning functions (kept separate so tests that mock `authMiddleware` never import them) |
| Create `rehire/__tests__/rehireAccess.test.ts`, `rehireGovernanceRoutes.test.ts`, `rejoinFollowUps.test.ts` | tests |
| Modify `rehire/__tests__/rejoinRoutes.test.ts` | mock the follow-ups modules, add a test that approval triggers them after commit |

Shared test helper pattern (each test file defines its own copy):

```ts
function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
```

---

### Task 1: Shared manager-scope check + live eligibility endpoint

**Files:**
- Create: `backend/src/modules/employees/rehire/rehireAccess.ts`
- Modify: `backend/src/modules/employees/employee-reactivation.routes.ts` (the `role === "manager"` block inside `/reactivation/initiate`)
- Modify: `backend/src/modules/employees/employee-governance.routes.ts`
- Test: `backend/src/modules/employees/rehire/__tests__/rehireAccess.test.ts`, `backend/src/modules/employees/rehire/__tests__/rehireGovernanceRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

`rehireAccess.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { isFormerReport } from "../rehireAccess.js";

const db = (n: number) => ({ execute: vi.fn(async () => [[{ is_manager: n }], []]) });

describe("isFormerReport", () => {
  it("is true when the caller is the employee's reporting manager", async () => {
    expect(await isFormerReport(db(1) as never, "e1", "u1")).toBe(true);
  });
  it("is false when they are not", async () => {
    expect(await isFormerReport(db(0) as never, "e1", "u1")).toBe(false);
  });
  it("binds the employee id then the user id", async () => {
    const d = db(1);
    await isFormerReport(d as never, "e1", "u1");
    expect(d.execute.mock.calls[0]![1]).toEqual(["e1", "u1"]);
    expect(String(d.execute.mock.calls[0]![0])).toContain("reporting_manager_id");
  });
});
```

`rehireGovernanceRoutes.test.ts` (this file is extended in Task 2; Task 1 writes only the eligibility describe-block and the shared mocks):

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));

const { loadRehireFacts } = vi.hoisted(() => ({ loadRehireFacts: vi.fn() }));
vi.mock("../rehireFacts.js", async (orig) => ({ ...(await orig<typeof import("../rehireFacts.js")>()), loadRehireFacts }));

const { isFormerReport } = vi.hoisted(() => ({ isFormerReport: vi.fn() }));
vi.mock("../rehireAccess.js", () => ({ isFormerReport }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../../shared/auditLog.js", () => ({ logSensitiveAction }));

let authUser = { id: "u1", role: "hr", roles: ["hr"] };
vi.mock("../../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

const { employeeGovernanceRouter } = await import("../../employee-governance.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/employees", employeeGovernanceRouter); return a; };

const EMP = "11111111-1111-4111-8111-111111111111";
const cleanFacts = {
  exitRequestId: "x1", previousEndDate: "2026-09-10", ffAlreadyPaid: false,
  facts: { hasExitRecord: true, exitType: "voluntary", exitSubType: "resignation", exitReasonCategory: "relocation", legacyStatusText: "Resigned",
    disciplinaryFlag: false, blockLifted: false, gapDays: 10, priorRejoinCount: 0, totalAbscondingExits: 0,
    openClearanceCase: false, assetsUnreturned: false, ffAlreadyPaid: false },
};

beforeEach(() => {
  dbExecute.mockReset(); canViewEmployee.mockReset(); loadRehireFacts.mockReset(); isFormerReport.mockReset(); logSensitiveAction.mockReset();
  canViewEmployee.mockResolvedValue(true);
  isFormerReport.mockResolvedValue(true);
  dbExecute.mockResolvedValue([[], []]);
  loadRehireFacts.mockResolvedValue(cleanFacts);
});

describe("GET /:id/rehire-eligibility", () => {
  it("403s a role with no business asking", async () => {
    authUser = { id: "u1", role: "employee", roles: ["employee"] };
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(403);
  });

  it("400s a missing or malformed proposed_joining_date", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    expect((await request(app()).get(`/api/employees/${EMP}/rehire-eligibility`)).status).toBe(400);
    expect((await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=20-09-2026`)).status).toBe(400);
  });

  it("403s a caller outside the employee's scope", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(403);
    expect(loadRehireFacts).not.toHaveBeenCalled();
  });

  it("403s a manager who never managed the employee", async () => {
    authUser = { id: "m1", role: "manager", roles: ["manager"] };
    isFormerReport.mockResolvedValue(false);
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(403);
    expect(isFormerReport).toHaveBeenCalledWith(expect.anything(), EMP, "m1");
  });

  it("404s an unknown employee", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue(null);
    expect((await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`)).status).toBe(404);
  });

  it("returns the verdict for an eligible leaver, and read-only (no writes)", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(200);
    expect(res.body.data.eligibility.status).toBe("eligible");
    expect(res.body.data.gapDays).toBe(10);
    expect(dbExecute.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql)))).toBe(false);
  });

  it("returns blocked with reasons for a terminated employee", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue({ ...cleanFacts, facts: { ...cleanFacts.facts, exitSubType: "termination" } });
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(200);
    expect(res.body.data.eligibility.status).toBe("blocked");
    expect(res.body.data.eligibility.reasons[0].code).toBe("TERMINATED");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rehireAccess.test.ts src/modules/employees/rehire/__tests__/rehireGovernanceRoutes.test.ts`
Expected: FAIL — `rehireAccess.js` missing; governance router has no routes.

- [ ] **Step 3: Write `rehireAccess.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import type { SqlExecutor } from "./rehireFacts.js";

/**
 * A reporting manager may raise or look up a rejoin only for someone who reported to them.
 * `employees.reporting_manager_id` points at the manager's employees.id; the caller is a users.id,
 * so the join goes through employees.user_id.
 */
export async function isFormerReport(db: SqlExecutor, employeeId: string, userId: string): Promise<boolean> {
  const [rows] = await db.execute<(RowDataPacket & { is_manager: number })[]>(
    `SELECT COUNT(*) AS is_manager FROM employees e
       JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id = ? AND m.user_id = ?`,
    [employeeId, userId],
  );
  return Number(rows[0]?.is_manager) > 0;
}
```

- [ ] **Step 4: Use it in `initiate`**

In `employee-reactivation.routes.ts`, add `import { isFormerReport } from "./rehire/rehireAccess.js";` and replace the whole `if (role === "manager") { ... }` block inside the initiate handler with:

```ts
      if (role === "manager" && !(await isFormerReport(pool, body.employee_id, initiatedBy))) {
        return res.status(403).json({ success: false, message: "You can raise a rejoin only for an employee who reported to you" });
      }
```

The SQL text is identical to what was inline, so `rejoinRoutes.test.ts` (which keys on `reporting_manager_id`) keeps passing.

- [ ] **Step 5: Write the governance router (eligibility endpoint only for now)**

Replace the stub `backend/src/modules/employees/employee-governance.routes.ts` with:

```ts
import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { evaluateRehire } from "./rehire/rehireEligibility.js";
import { loadRehireFacts } from "./rehire/rehireFacts.js";
import { isFormerReport } from "./rehire/rehireAccess.js";

export const employeeGovernanceRouter = Router();

employeeGovernanceRouter.use(requireAuth);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// ── GET /:id/rehire-eligibility?proposed_joining_date=YYYY-MM-DD ──────────────
// Read-only. Powers the live eligibility panel on the raise form, so HR or a manager sees
// "blocked: terminated" BEFORE filling the form. Same facts and same rules as initiate and
// as the approval re-check, so the three can never disagree.
employeeGovernanceRouter.get(
  "/:id/rehire-eligibility",
  requireRole("hr", "admin", "super_admin", "manager", "branch_head"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = DATE.safeParse(req.query.proposed_joining_date);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "proposed_joining_date (YYYY-MM-DD) is required" });
      }
      const employeeId = String(req.params.id);
      const userId = req.authUser!.id;

      if (!(await canViewEmployee(userId, employeeId))) {
        return res.status(403).json({ success: false, message: "This employee is outside your branch / assigned scope" });
      }
      if (req.authUser!.role === "manager" && !(await isFormerReport(pool, employeeId, userId))) {
        return res.status(403).json({ success: false, message: "You can look this up only for an employee who reported to you" });
      }

      const loaded = await loadRehireFacts(pool, employeeId, parsed.data);
      if (!loaded) return res.status(404).json({ success: false, message: "Employee not found" });

      return res.json({
        success: true,
        data: {
          employeeId,
          proposedJoiningDate: parsed.data,
          gapDays: loaded.facts.gapDays,
          previousEndDate: loaded.previousEndDate,
          eligibility: evaluateRehire(loaded.facts),
        },
      });
    } catch (err: any) {
      console.error("[Governance] rehire-eligibility failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to check eligibility" });
    }
  },
);
```

(`z`, `RowDataPacket`, `logSensitiveAction` are used by Task 2; if the linter flags them unused right now, add them in Task 2 instead.)

- [ ] **Step 6: Run the tests**

Run: `cd backend && npx vitest run src/modules/employees/rehire`
Expected: PASS (all rehire tests, including the unchanged `rejoinRoutes.test.ts`). Run `npx tsc --noEmit`: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/employees
git commit -m "feat(rejoin): shared manager-scope check and live rehire-eligibility endpoint

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Disciplinary flag (HR) and lift (super_admin)

**Files:**
- Modify: `backend/src/modules/employees/employee-governance.routes.ts` (append)
- Test: `backend/src/modules/employees/rehire/__tests__/rehireGovernanceRoutes.test.ts` (append two describe-blocks)

Rules: HR/admin/super_admin may flag; flagging again re-arms a previously lifted block (clears the lift columns). Only a super_admin may lift, needs a reason of at least 20 characters, and only when an active (un-lifted) flag exists. A lift clears only the disciplinary block; termination, misconduct and performance exits stay blocked because `evaluateRehire` never consults the lift for them. Every action writes `logSensitiveAction`. A pending rejoin request is not cancelled here: approval re-evaluates eligibility from live facts and will refuse it.

- [ ] **Step 1: Append the failing tests**

```ts
describe("POST /:id/rehire-block/flag", () => {
  const body = { reason: "Fraudulent expense claims found after exit", flag_date: "2026-09-30" };

  it("403s a role that cannot flag (branch_head, manager)", async () => {
    for (const role of ["branch_head", "manager", "employee"]) {
      authUser = { id: "u1", role, roles: [role] };
      expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body)).status).toBe(403);
    }
  });

  it("400s a short reason", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send({ reason: "bad" });
    expect(res.status).toBe(400);
  });

  it("403s an employee outside scope and writes nothing", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body);
    expect(res.status).toBe(403);
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it("404s an unknown employee", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    dbExecute.mockResolvedValue([[], []]);
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body)).status).toBe(404);
  });

  it("upserts the flag, re-arms a previous lift, and audits", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT id FROM employees") ? [[{ id: EMP }], []] : [{ affectedRows: 1 }, []]);
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body);
    expect(res.status).toBe(200);
    const up = dbExecute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_rehire_control"))!;
    const sql = String(up[0]);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(sql).toMatch(/block_lifted_at\s*=\s*NULL/i);
    expect(up[1]).toEqual([EMP, body.reason, "2026-09-30", "hr1", null]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      actor_user_id: "hr1", action_type: "REHIRE_DISCIPLINARY_FLAG_SET", entity_id: EMP, employee_id: EMP,
    }));
  });

  it("defaults the flag date to today when none is given", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT id FROM employees") ? [[{ id: EMP }], []] : [{ affectedRows: 1 }, []]);
    await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send({ reason: "Misconduct discovered on audit" });
    const up = dbExecute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_rehire_control"))!;
    expect((up[1] as unknown[])[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("POST /:id/rehire-block/lift", () => {
  const body = { reason: "Cleared after legal review, written approval on file" };

  it("403s everyone but super_admin — including admin and hr", async () => {
    for (const role of ["admin", "hr", "branch_head"]) {
      authUser = { id: "u1", role, roles: [role] };
      expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body)).status).toBe(403);
    }
  });

  it("400s a reason under 20 characters", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send({ reason: "short reason" })).status).toBe(400);
  });

  it("409s when there is no active flag to lift", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    dbExecute.mockResolvedValue([[], []]);
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body)).status).toBe(409);
  });

  it("409s when the flag was already lifted", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    dbExecute.mockResolvedValue([[{ disciplinary_flag: 1, block_lifted_at: "2026-09-01 10:00:00" }], []]);
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body)).status).toBe(409);
  });

  it("lifts an active flag, records who and why, and audits", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("FROM employee_rehire_control") ? [[{ disciplinary_flag: 1, block_lifted_at: null }], []] : [{ affectedRows: 1 }, []]);
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body);
    expect(res.status).toBe(200);
    const up = dbExecute.mock.calls.find(([sql]) => String(sql).includes("UPDATE employee_rehire_control"))!;
    expect(up[1]).toEqual(["sa1", body.reason, EMP]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      actor_user_id: "sa1", action_type: "REHIRE_BLOCK_LIFTED", entity_id: EMP, reason: body.reason,
    }));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rehireGovernanceRoutes.test.ts`
Expected: FAIL — the flag and lift routes do not exist (404s).

- [ ] **Step 3: Append the two routes to `employee-governance.routes.ts`**

```ts
const flagSchema = z.object({
  reason: z.string().trim().min(10, "Give the reason (at least 10 characters)"),
  flag_date: DATE.optional(),
  document_url: z.string().trim().url().max(500).optional(),
});

const todayIso = () => new Date().toISOString().slice(0, 10);

// ── POST /:id/rehire-block/flag ───────────────────────────────────────────────
// HR records a disciplinary finding. It can be set at any time, including after the person has left
// (a fraud found in an audit). Flagging again re-arms a block a super_admin had lifted.
// A pending rejoin request is not cancelled here: approval re-evaluates eligibility from live facts
// (rejoinActivation.ts) and will refuse it.
employeeGovernanceRouter.post(
  "/:id/rehire-block/flag",
  requireRole("hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = flagSchema.parse(req.body);
      const employeeId = String(req.params.id);
      const actorId = req.authUser!.id;

      if (!(await canViewEmployee(actorId, employeeId))) {
        return res.status(403).json({ success: false, message: "This employee is outside your branch / assigned scope" });
      }
      const [emp] = await pool.execute<RowDataPacket[]>("SELECT id FROM employees WHERE id = ?", [employeeId]);
      if (!emp.length) return res.status(404).json({ success: false, message: "Employee not found" });

      const flagDate = body.flag_date ?? todayIso();
      await pool.execute(
        `INSERT INTO employee_rehire_control
           (employee_id, disciplinary_flag, disciplinary_reason, disciplinary_flag_date, disciplinary_flagged_by, disciplinary_document_url)
         VALUES (?, 1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           disciplinary_flag = 1,
           disciplinary_reason = VALUES(disciplinary_reason),
           disciplinary_flag_date = VALUES(disciplinary_flag_date),
           disciplinary_flagged_by = VALUES(disciplinary_flagged_by),
           disciplinary_document_url = VALUES(disciplinary_document_url),
           block_lifted_by = NULL, block_lifted_at = NULL, block_lift_reason = NULL`,
        [employeeId, body.reason, flagDate, actorId, body.document_url ?? null],
      );

      await logSensitiveAction({
        actor_user_id: actorId,
        action_type: "REHIRE_DISCIPLINARY_FLAG_SET",
        module_key: "employees",
        entity_type: "employee",
        entity_id: employeeId,
        employee_id: employeeId,
        change_summary: { fields: ["disciplinary_flag"] },
        new_value_json: { disciplinary_flag: 1, flag_date: flagDate },
        reason: body.reason,
        req,
      });

      return res.json({ success: true, message: "Disciplinary flag recorded. This employee can no longer be rejoined." });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Governance] flag failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to record the flag" });
    }
  },
);

const liftSchema = z.object({
  reason: z.string().trim().min(20, "A lift needs a written reason of at least 20 characters"),
});

// ── POST /:id/rehire-block/lift ───────────────────────────────────────────────
// super_admin ONLY — requireRole("super_admin") rejects admin and hr. This clears only the
// disciplinary-flag block. Termination, misconduct and performance exits stay blocked regardless:
// evaluateRehire never consults the lift for those.
employeeGovernanceRouter.post(
  "/:id/rehire-block/lift",
  requireRole("super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = liftSchema.parse(req.body);
      const employeeId = String(req.params.id);
      const actorId = req.authUser!.id;

      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT disciplinary_flag, block_lifted_at FROM employee_rehire_control WHERE employee_id = ?",
        [employeeId],
      );
      const row = rows[0];
      if (!row || Number(row.disciplinary_flag) !== 1) {
        return res.status(409).json({ success: false, message: "There is no disciplinary flag on this employee to lift" });
      }
      if (row.block_lifted_at != null) {
        return res.status(409).json({ success: false, message: "This flag has already been lifted" });
      }

      await pool.execute(
        `UPDATE employee_rehire_control
            SET block_lifted_by = ?, block_lifted_at = NOW(), block_lift_reason = ?
          WHERE employee_id = ?`,
        [actorId, body.reason, employeeId],
      );

      await logSensitiveAction({
        actor_user_id: actorId,
        action_type: "REHIRE_BLOCK_LIFTED",
        module_key: "employees",
        entity_type: "employee",
        entity_id: employeeId,
        employee_id: employeeId,
        change_summary: { fields: ["block_lifted_at"] },
        reason: body.reason,
        req,
      });

      return res.json({ success: true, message: "Disciplinary block lifted." });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Invalid input", errors: err.errors });
      }
      console.error("[Governance] lift failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to lift the block" });
    }
  },
);
```

- [ ] **Step 4: Run the tests, type-check, and the guards**

Run: `cd backend && npx vitest run src/modules/employees src/platform src/db tests 2>&1 | tail -15 && npx tsc --noEmit`
Expected: the new tests pass; the only failing files are the 3 pre-existing (`shivamgiri-schema-case`, `upload-batch-retention`, `esignDeadKitRedispatch`). Any other failure from a route/RBAC/registry/schema guard must be fixed by registering the way the guard asks, never by weakening it. If an RBAC page/route matrix test asks for these routes to be declared, add them there.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(rejoin): HR disciplinary flag and super_admin-only lift, both audited

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Post-activation follow-ups

**Files:**
- Create: `backend/src/modules/employees/rehire/rejoinFollowUps.ts`
- Create: `backend/src/modules/employees/rehire/rejoinFollowUps.deps.ts`
- Test: `backend/src/modules/employees/rehire/__tests__/rejoinFollowUps.test.ts`

Steps, each isolated (a throw or `ok:false` in one never stops the others, and never rolls back the approval):
1. `auth` — if the employee has a `user_id`, clear the auth-context cache so login works immediately; if `user_id` is NULL, report `ok:false` ("no login account is linked; HR must create one") because there is nothing to revive.
2. `lms` — set `lms_employee_mapping.is_active = 1` for the employee (exit set it to 0).
3. `it_provisioning` — re-raise the join tasks (email, biometric, dialer, domain) unless an open join request already exists.
4. `audit` — one `employee_reactivation_audit` row, action `rejoin_followups`, metadata = the step results.

- [ ] **Step 0: Verify two assumptions against the repo before writing code**

(a) In `backend/src/modules/it-provisioning/it-provisioning.service.ts` read `dispatchJoinProvisioningTasks` and `createRequest`: find out whether `createRequest` already dedupes (same employee + task), and read the `it_provisioning_request` columns in `backend/sql/schema-snapshot.json`. (b) Confirm `invalidateAuthContextCache(userId)` is exported from `backend/src/middleware/authMiddleware.ts`. If (a) shows `createRequest` dedupes, drop the `hasOpenJoinRequest` guard below and call the dispatcher directly; if the snapshot lacks the `employee_id`, `request_type` or `status` column names used below, use the real names. Record what you found in the commit message body.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { runRejoinFollowUps, type FollowUpDeps } from "../rejoinFollowUps.js";

function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}

const employee = { id: "e1", employee_code: "MAS001", full_name: "Asha Rao", branch_id: "b1", user_id: "u9", date_of_joining: "2025-07-15" };
const input = { requestId: "r1", employeeId: "e1", approverId: "bh1", rejoinDate: "2026-09-20" };

function deps(over: Partial<FollowUpDeps> = {}): FollowUpDeps {
  return {
    invalidateAuthContextCache: vi.fn(),
    dispatchJoinProvisioningTasks: vi.fn(async () => undefined),
    ...over,
  };
}
const base = {
  "FROM employees": [employee],
  "UPDATE lms_employee_mapping": [{ affectedRows: 1 }],
  "FROM it_provisioning_request": [{ n: 0 }],
  "INSERT INTO employee_reactivation_audit": [{ affectedRows: 1 }],
};

describe("runRejoinFollowUps", () => {
  it("runs every step and reports all ok", async () => {
    const d = deps();
    const results = await runRejoinFollowUps(executor(base) as never, d, input);
    expect(results.map((r) => [r.step, r.ok])).toEqual([["auth", true], ["lms", true], ["it_provisioning", true]]);
    expect(d.invalidateAuthContextCache).toHaveBeenCalledWith("u9");
    expect(d.dispatchJoinProvisioningTasks).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "e1", employeeCode: "MAS001", employeeName: "Asha Rao", branchId: "b1", actorUserId: "bh1", joiningDate: "2026-09-20",
    }));
  });

  it("reactivates the LMS mapping for this employee", async () => {
    const ex = executor(base);
    await runRejoinFollowUps(ex as never, deps(), input);
    const call = ex.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE lms_employee_mapping"))!;
    expect(String(call[0])).toMatch(/is_active\s*=\s*1/);
    expect(call[1]).toEqual(["e1"]);
  });

  it("flags — does not pretend — when the employee has no login account", async () => {
    const d = deps();
    const ex = executor({ ...base, "FROM employees": [{ ...employee, user_id: null }] });
    const results = await runRejoinFollowUps(ex as never, d, input);
    const auth = results.find((r) => r.step === "auth")!;
    expect(auth.ok).toBe(false);
    expect(auth.detail).toMatch(/no login account/i);
    expect(d.invalidateAuthContextCache).not.toHaveBeenCalled();
  });

  it("skips IT provisioning when a join request is already open", async () => {
    const d = deps();
    const ex = executor({ ...base, "FROM it_provisioning_request": [{ n: 2 }] });
    const results = await runRejoinFollowUps(ex as never, d, input);
    expect(d.dispatchJoinProvisioningTasks).not.toHaveBeenCalled();
    expect(results.find((r) => r.step === "it_provisioning")).toMatchObject({ ok: true, detail: expect.stringMatching(/already open/i) });
  });

  it("one failing step is recorded and the others still run", async () => {
    const d = deps({ dispatchJoinProvisioningTasks: vi.fn(async () => { throw new Error("IT down"); }) });
    const ex = executor({ ...base, "UPDATE lms_employee_mapping": new Error("no such table") });
    const results = await runRejoinFollowUps(ex as never, d, input);
    expect(results.find((r) => r.step === "auth")!.ok).toBe(true);
    expect(results.find((r) => r.step === "lms")).toMatchObject({ ok: false, detail: "no such table" });
    expect(results.find((r) => r.step === "it_provisioning")).toMatchObject({ ok: false, detail: "IT down" });
  });

  it("never throws, even when the employee cannot be loaded", async () => {
    const results = await runRejoinFollowUps(executor({ ...base, "FROM employees": new Error("db gone") }) as never, deps(), input);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.ok === false)).toBe(true);
  });

  it("writes one audit row with the step results, and a failing audit write does not throw", async () => {
    const ex = executor(base);
    await runRejoinFollowUps(ex as never, deps(), input);
    const audit = ex.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_reactivation_audit"))!;
    expect(audit[1]![0]).toBe("r1");
    expect(audit[1]![1]).toBe("bh1");
    expect(JSON.parse(String(audit[1]![3])).steps.map((s: { step: string }) => s.step)).toEqual(["auth", "lms", "it_provisioning"]);

    const failing = executor({ ...base, "INSERT INTO employee_reactivation_audit": new Error("audit down") });
    await expect(runRejoinFollowUps(failing as never, deps(), input)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rejoinFollowUps.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `rejoinFollowUps.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import type { SqlExecutor } from "./rehireFacts.js";

export interface FollowUpResult {
  step: "auth" | "lms" | "it_provisioning";
  ok: boolean;
  detail?: string;
}

export interface FollowUpInput {
  requestId: string;
  employeeId: string;
  approverId: string;
  /** The rejoin date, 'YYYY-MM-DD'. */
  rejoinDate: string;
}

/** The two side-effecting dependencies are injected so this unit never imports auth or IT-provisioning modules. */
export interface FollowUpDeps {
  invalidateAuthContextCache: (userId: string) => void;
  dispatchJoinProvisioningTasks: (input: {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    branchId: string | null;
    actorUserId: string;
    joiningDate?: string;
  }) => Promise<unknown>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What exit switched off, switched back on. Runs AFTER the approval has committed and never throws:
 * a failed follow-up is recorded and returned so HR can see it, it does not undo the approval.
 *
 * Deliberately NOT here (see the plan's research notes):
 *  - login re-provisioning: exit never blocks auth_user or touches roles, so active_status=1 already
 *    restores login; only the 30s auth cache needs clearing.
 *  - leave: exit never zeroes the ledger and the rejoin gap is at most 30 days, so balances stand.
 *  - reportees orphaned at exit: they may have been reassigned since.
 */
export async function runRejoinFollowUps(
  db: SqlExecutor,
  deps: FollowUpDeps,
  input: FollowUpInput,
): Promise<FollowUpResult[]> {
  const results: FollowUpResult[] = [];

  let emp: RowDataPacket | undefined;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code,
              COALESCE(NULLIF(full_name, ''), CONCAT(first_name, ' ', last_name)) AS full_name,
              branch_id, user_id
         FROM employees WHERE id = ?`,
      [input.employeeId],
    );
    emp = rows[0];
  } catch (e) {
    const detail = `could not load the employee: ${msg(e)}`;
    return (["auth", "lms", "it_provisioning"] as const).map((step) => ({ step, ok: false, detail }));
  }
  if (!emp) {
    return (["auth", "lms", "it_provisioning"] as const).map((step) => ({ step, ok: false, detail: "employee not found" }));
  }

  // 1. Login: clear the auth cache so access returns at once; flag when there is no account to revive.
  try {
    if (emp.user_id) {
      deps.invalidateAuthContextCache(String(emp.user_id));
      results.push({ step: "auth", ok: true });
    } else {
      results.push({ step: "auth", ok: false, detail: "No login account is linked to this employee; HR must create one." });
    }
  } catch (e) {
    results.push({ step: "auth", ok: false, detail: msg(e) });
  }

  // 2. LMS: exit set is_active = 0.
  try {
    await db.execute(`UPDATE lms_employee_mapping SET is_active = 1 WHERE employee_id = ?`, [input.employeeId]);
    results.push({ step: "lms", ok: true });
  } catch (e) {
    results.push({ step: "lms", ok: false, detail: msg(e) });
  }

  // 3. IT: exit raised email / biometric / dialer / domain DELETE tasks; raise the join tasks again,
  //    unless one is already open (do not double-raise on a retry).
  try {
    const [openRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM it_provisioning_request
        WHERE employee_id = ? AND request_type = 'join' AND LOWER(status) NOT IN ('completed', 'cancelled', 'rejected')`,
      [input.employeeId],
    );
    if (Number(openRows[0]?.n) > 0) {
      results.push({ step: "it_provisioning", ok: true, detail: "A join provisioning request is already open." });
    } else {
      await deps.dispatchJoinProvisioningTasks({
        employeeId: String(emp.id),
        employeeCode: String(emp.employee_code),
        employeeName: String(emp.full_name ?? "").trim(),
        branchId: emp.branch_id ?? null,
        actorUserId: input.approverId,
        joiningDate: input.rejoinDate,
      });
      results.push({ step: "it_provisioning", ok: true });
    }
  } catch (e) {
    results.push({ step: "it_provisioning", ok: false, detail: msg(e) });
  }

  // 4. Audit. A failing audit write must not mask the results.
  try {
    await db.execute(
      `INSERT INTO employee_reactivation_audit (request_id, action, actioned_by, remarks, metadata)
       VALUES (?, 'rejoin_followups', ?, ?, ?)`,
      [
        input.requestId,
        input.approverId,
        results.every((r) => r.ok) ? "all follow-ups completed" : "some follow-ups need attention",
        JSON.stringify({ steps: results }),
      ],
    );
  } catch {
    /* the results are still returned to the caller */
  }

  return results;
}
```

- [ ] **Step 4: Write `rejoinFollowUps.deps.ts`**

```ts
import { invalidateAuthContextCache } from "../../../middleware/authMiddleware.js";
import { dispatchJoinProvisioningTasks } from "../../it-provisioning/it-provisioning.service.js";
import type { FollowUpDeps } from "./rejoinFollowUps.js";

/**
 * The real wiring, kept out of rejoinFollowUps.ts on purpose: tests that mock authMiddleware with only
 * requireAuth would otherwise fail on the missing invalidateAuthContextCache export.
 */
export const realFollowUpDeps: FollowUpDeps = {
  invalidateAuthContextCache,
  dispatchJoinProvisioningTasks: (input) => dispatchJoinProvisioningTasks(input),
};
```

If Step 0 showed `dispatchJoinProvisioningTasks` takes a differently shaped argument, adapt this adapter (not the injected interface) so the tested interface stays stable.

- [ ] **Step 5: Run the test, type-check**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rejoinFollowUps.test.ts && npx tsc --noEmit`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/employees/rehire
git commit -m "feat(rejoin): isolated post-activation follow-ups (auth cache, LMS, IT tasks)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Run the follow-ups after the approval commits

**Files:**
- Modify: `backend/src/modules/employees/employee-reactivation.routes.ts` (`branch-action` handler)
- Modify: `backend/src/modules/employees/rehire/__tests__/rejoinRoutes.test.ts`

The follow-ups run **after** `conn.commit()`, and their outcome is returned in the response (`followUps`) so the review page can show a warning. A follow-up failure never changes the HTTP status: the employee is already active.

- [ ] **Step 1: Update the route test (failing first)**

At the top of `rejoinRoutes.test.ts`, next to the other `vi.hoisted` mocks add:

```ts
const { runRejoinFollowUps } = vi.hoisted(() => ({ runRejoinFollowUps: vi.fn() }));
vi.mock("../rejoinFollowUps.js", () => ({ runRejoinFollowUps }));
vi.mock("../rejoinFollowUps.deps.js", () => ({ realFollowUpDeps: { marker: "deps" } }));
```

In the existing `beforeEach` add `runRejoinFollowUps.mockReset(); runRejoinFollowUps.mockResolvedValue([{ step: "auth", ok: true }]);`.

Append inside `describe("POST /reactivation/:id/branch-action", ...)`:

```ts
  it("runs the follow-ups only AFTER the approval commits, and returns their outcome", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    const order: string[] = [];
    c.commit.mockImplementation(async () => { order.push("commit"); });
    runRejoinFollowUps.mockImplementation(async () => { order.push("followups"); return [{ step: "auth", ok: true }]; });
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(order).toEqual(["commit", "followups"]);
    expect(runRejoinFollowUps).toHaveBeenCalledWith(
      expect.anything(), { marker: "deps" },
      { requestId: "r1", employeeId: "e1", approverId: "bh1", rejoinDate: "2026-09-20" },
    );
    expect(res.body.followUps).toEqual([{ step: "auth", ok: true }]);
  });

  it("a failing follow-up does not change the outcome: still 200, the failure is reported", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    runRejoinFollowUps.mockResolvedValue([{ step: "it_provisioning", ok: false, detail: "IT down" }]);
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(res.body.followUps[0].ok).toBe(false);
  });

  it("even if the follow-up runner itself throws, the approval stands", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    runRejoinFollowUps.mockRejectedValue(new Error("boom"));
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(res.body.followUps).toEqual([]);
  });

  it("does not run follow-ups on a rejection", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "rejected", remarks: "poor record" });
    expect(runRejoinFollowUps).not.toHaveBeenCalled();
  });

  it("does not run follow-ups when activation refuses", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    const { RejoinBlockedError } = await import("../rejoinActivation.js");
    activateRejoin.mockRejectedValue(new RejoinBlockedError({ status: "blocked", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false }, "Left through termination"));
    await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(runRejoinFollowUps).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rejoinRoutes.test.ts`
Expected: the new "follow-ups" tests FAIL (never called).

- [ ] **Step 3: Edit the handler**

In `employee-reactivation.routes.ts` add imports:

```ts
import { runRejoinFollowUps, type FollowUpResult } from "./rehire/rejoinFollowUps.js";
import { realFollowUpDeps } from "./rehire/rejoinFollowUps.deps.js";
```

In the `branch-action` handler the success path currently is:

```ts
        await conn.commit();
        return res.json({ success: true, message: body.action === "approved" ? "Rejoin approved; employee is active again" : "Rejoin request rejected" });
```

Replace those two statements with:

```ts
        await conn.commit();

        // After the commit, never inside the transaction: the follow-ups use the pool, and their failure
        // must not undo an approval that is already durable.
        let followUps: FollowUpResult[] = [];
        if (body.action === "approved") {
          try {
            followUps = await runRejoinFollowUps(pool, realFollowUpDeps, {
              requestId: String(request.id),
              employeeId: String(request.employee_id),
              approverId: actionedBy,
              rejoinDate: String(request.proposed_joining_date),
            });
          } catch (e) {
            console.error("[Reactivation] follow-ups failed after approval:", e);
          }
        }

        return res.json({
          success: true,
          message: body.action === "approved" ? "Rejoin approved; employee is active again" : "Rejoin request rejected",
          followUps,
        });
```

`request.proposed_joining_date` comes from `SELECT *` on the request row; mysql2 may hand a DATE back as a JS Date. Normalise it before use: add near the top of the handler's success branch `const rejoinDate = request.proposed_joining_date instanceof Date ? request.proposed_joining_date.toISOString().slice(0, 10) : String(request.proposed_joining_date).slice(0, 10);` and pass `rejoinDate` to `runRejoinFollowUps` (and to `activateRejoin`, which already receives `request.proposed_joining_date` — leave that call unchanged since Plan 1 tested it; only the follow-up uses `rejoinDate`). If the project's mysql2 pool sets `dateStrings`, this is a no-op.

- [ ] **Step 4: Run all rejoin tests, type-check, guards**

Run: `cd backend && npx vitest run src/modules/employees src/platform src/db tests 2>&1 | tail -12 && npx tsc --noEmit`
Expected: PASS apart from the 3 pre-existing failing files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees
git commit -m "feat(rejoin): run follow-ups after the approval commits and report the outcome

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verify the new SQL against a real MySQL (no prod) and the full suite

The unit tests use fake executors, so this closes the gap exactly as Task 9 of Plan 2a did.

- [ ] **Step 1:** Start a throwaway `mysql:8.0` container (unique name, `--rm`, remove it at the end; touch no other container and no real database). Build the schema from repo SQL for: `employees`, `employee_rehire_control` and `employee_reactivation_requests` (from `backend/sql/migrations/2079_employee_rejoin_v3.sql`), `employee_reactivation_audit` (`sql/020_employee_reactivation.sql`), `lms_employee_mapping`, `it_provisioning_request`, plus whatever `loadRehireFacts` reads (`exit_request`, `employment_stint`, `exit_clearance_checklist`, `asset_assignment`, `full_final_calculation`). Strip FOREIGN KEY lines; cross-check column lists against `backend/sql/schema-snapshot.json`.
- [ ] **Step 2:** Through a real `mysql2` pool run, against the scratch DB: the flag upsert twice (second must update, and clear a prior lift), the lift UPDATE, the LMS `UPDATE ... is_active = 1`, the `it_provisioning_request` count query, and the `employee_reactivation_audit` insert; plus `loadRehireFacts` + `evaluateRehire` for a flagged and an unflagged employee (the flagged one must come back `blocked` with `DISCIPLINARY_FLAG`; after a lift it must not; after re-flagging it must block again). Any SQL error means a wrong column name: fix it against the snapshot and keep the unit tests green.
- [ ] **Step 3:** Mount the real governance router with a pool to the scratch DB and stubbed auth/`canViewEmployee`; call flag → eligibility → lift → eligibility end to end and confirm the JSON.
- [ ] **Step 4:** Tear down the container. Run `cd backend && npm run build && npx vitest run 2>&1 | tail -20`; the only failing files must be the 3 pre-existing ones. Run `graphify update .` from the repo root if the command exists.
- [ ] **Step 5:** Commit any query fixes: `git commit -m "fix(rejoin): align flag and follow-up queries with the real schema"` (skip if nothing changed). Report plainly what was and was not verified; do not push.

---

## Self-Review

**Coverage of the spec items this plan owns**
- "Blocked means blocked; only super_admin lifts with a written reason and audit" → Task 2 (flag, lift, audit, re-arm on re-flag).
- "Disciplinary flag: reason, date, document; settable any time including post-exit; setting it blocks" → Task 2.
- Live eligibility panel on the raise form (HR and manager) → Task 1 endpoint.
- "Re-provision the login via the existing job; restore leave if gap ≤ 30 days; start fresh otherwise" → Task 3, with the research-backed correction: login needs only a cache clear, leave needs nothing for gaps ≤ 30 days and a longer gap cannot rejoin through this flow. LMS and IT tasks, which exit actually switched off, are undone.
- "Notify requester, HR, payroll", reminders, escalation, ATS duplicate catch → **Plan 3b**. Split-month payroll → **Plan 3c**.

**Placeholders:** none. Task 3 Step 0 is a deliberate read-and-confirm of two facts the research could not settle (IT dedupe and column names); the code beside it states the assumption and the fallback.

**Type consistency:** `isFormerReport(db, employeeId, userId)` (Task 1) is used identically by `initiate` and the eligibility route. `FollowUpDeps`, `FollowUpInput` `{requestId, employeeId, approverId, rejoinDate}`, `FollowUpResult` `{step, ok, detail?}`, `runRejoinFollowUps(db, deps, input)` (Task 3) match the Task 4 call and tests. `realFollowUpDeps` is the only importer of `authMiddleware.invalidateAuthContextCache`.

**Risks to watch:** mock keys match SQL by substring, so a key that matches two statements returns the wrong rows (adjust SQL text, never the key); `mysql2` may return a DATE as a JS Date (handled in Task 4); `requireRole("super_admin")` rejects `admin`, which is intended and tested.
