## Global Constraints (from the plan)


- AON reference date is `COALESCE(e.salary_start_date, e.date_of_joining)` everywhere AON is
  computed — never `date_of_joining` alone (per approved spec §1).
- AON Attrition Rate = `exits_in_bucket_during_period ÷ AVG(at_risk_population_at_period_start,
  at_risk_population_at_period_end) × 100`, computed per bucket × per group (per approved spec §2).
- Headline "Overall Attrition Rate %" = `exits_in_period ÷ AVG(total_headcount_at_period_start,
  total_headcount_at_period_end) × 100` — company-wide, not bucket-scoped.
- Two-panel model only: Panel 1 (Slice Detail, chip bar, narrows in place) → Panel 2 (Employee
  List) → per-employee detail drawer. Never more than 2 stacked `Sheet` panels plus the detail
  drawer (which replaces Panel 2's content when opened, not stacks a 3rd `Sheet` alongside it).
- Every new/modified query goes through the existing `appendScopeConditions()` /
  `appendFilterConditions()` from `backend/src/modules/reporting/executors/types.ts` — no new
  scope bypass.
- Flag-for-Retention-Review reuses `upsertOpenWorkItem()` from `backend/src/shared/workItem.ts`
  unchanged — no new Work Inbox plumbing.
- No changes to payroll/salary calculation logic (per `CLAUDE.md`'s
  `hrms2-never-change-salary-calculation` discipline) — this plan only reads `salary_start_date`,
  never writes it or any payroll table.
- Drill-down drawers follow the platform-wide Drill-Down Mandate in `CLAUDE.md`: right-side
  `Sheet`/`SheetContent side="right"` at `sm:max-w-2xl`, full height, scrollable; the per-employee
  detail drawer fetches from a dedicated `GET /api/employees/:id` (never reuses the list payload);
  monetary values formatted with `₹` and Indian locale; dates as `DD/MM/YYYY HH:mm`.
- Never run a full backend `tsc` — scope typecheck to touched files only (per
  `hrms2-backend-typecheck-orphans`). Never run `npm run typecheck` and trust the root tsconfig's
  frontend result as a real gate — use the project's real `npm run typecheck` script.
- Commit frequently, by explicit path only — never `git add -A` / `git add .` (shared-tree rule).


---

### Task 4: Flag for Retention Review endpoint

**Files:**
- Create: `backend/src/modules/reporting/aon-retention-flag.routes.ts`
- Modify: `backend/src/app.ts` (mount the new router)
- Test: `backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`

**Interfaces:**
- Consumes: `upsertOpenWorkItem` and `WorkItemInput` from `backend/src/shared/workItem.ts`
  (unchanged signature).
- Produces: `POST /api/reports/aon-analytics/flag-retention` — body `{ employeeId: string }`,
  response `{ success: true, outcome: "created" | "refreshed" }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { upsertOpenWorkItem } = vi.hoisted(() => ({ upsertOpenWorkItem: vi.fn() }));
vi.mock("../../../shared/workItem.js", () => ({ upsertOpenWorkItem }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
import { db } from "../../../db/mysql.js";
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
}));

import { aonRetentionFlagRouter } from "../aon-retention-flag.routes.js";

const app = express();
app.use(express.json());
app.use("/api/reports/aon-analytics", aonRetentionFlagRouter);

describe("POST /api/reports/aon-analytics/flag-retention", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls upsertOpenWorkItem with RETENTION_REVIEW for the given employee", async () => {
    mockExecute.mockResolvedValueOnce([[{
      id: "emp-1", reporting_manager_id: "mgr-1", branch_id: "b1",
    }], []]);
    mockExecute.mockResolvedValueOnce([[{ role_key: "manager" }], []]);
    upsertOpenWorkItem.mockResolvedValueOnce("created");

    const res = await request(app)
      .post("/api/reports/aon-analytics/flag-retention")
      .send({ employeeId: "emp-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, outcome: "created" });
    expect(upsertOpenWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemType: "RETENTION_REVIEW",
        entityType: "employee",
        entityId: "emp-1",
        assignedToRole: "manager",
      }),
    );
  });

  it("400s when employeeId is missing", async () => {
    const res = await request(app).post("/api/reports/aon-analytics/flag-retention").send({});
    expect(res.status).toBe(400);
  });
});
```

Check whether `supertest` is already a dev dependency (`grep supertest backend/package.json`); if
not, add it: `cd backend && npm install --save-dev supertest @types/supertest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`
Expected: FAIL — module `../aon-retention-flag.routes.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/src/modules/reporting/aon-retention-flag.routes.ts`:

```typescript
/**
 * Flag for Retention Review — the one write action on the AON Analytics drill-down page.
 *
 * Calls the existing, already-tested upsertOpenWorkItem() helper (backend/src/shared/workItem.ts)
 * -- the same idempotent Work Inbox writer already used by 7+ producers in this codebase. No new
 * work-item plumbing: flagging the same employee twice while a review is still open is a no-op
 * refresh, not a duplicate, because that idempotency is already proven for the shared helper.
 *
 * Routed by role (assignedToRole), not by a specific user id -- WorkItemInput has no
 * assignedToUserId field, and Work Inbox's existing branch/process row-scope on reads already
 * ensures only the relevant manager/branch head sees it.
 */
import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { upsertOpenWorkItem } from "../../shared/workItem.js";

export const aonRetentionFlagRouter = Router();

interface EmployeeForFlag extends RowDataPacket {
  id: string;
  reporting_manager_id: string | null;
  branch_id: string | null;
}

async function resolveAssignedRole(employeeId: string): Promise<string> {
  const [rows] = await db.execute<EmployeeForFlag[]>(
    `SELECT id, reporting_manager_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = rows[0];
  if (!emp?.reporting_manager_id) return "branch_head";

  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = (
       SELECT id FROM auth_user WHERE email = (
         SELECT COALESCE(NULLIF(TRIM(official_email),''), email) FROM employees WHERE id = ?
       ) LIMIT 1
     ) AND active_status = 1 LIMIT 1`,
    [emp.reporting_manager_id],
  );
  const role = (roleRows[0] as { role_key?: string } | undefined)?.role_key;
  return role ?? "branch_head";
}

aonRetentionFlagRouter.post(
  "/flag-retention",
  requireAuth,
  async (req: Request, res: Response) => {
    const employeeId = String((req.body as { employeeId?: unknown })?.employeeId ?? "").trim();
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const assignedToRole = await resolveAssignedRole(employeeId);
    const riskBand = String((req.body as { riskBand?: unknown })?.riskBand ?? "").trim();
    const priority = riskBand === "High" ? "high" : riskBand === "Medium" ? "normal" : "low";

    const outcome = await upsertOpenWorkItem({
      itemType: "RETENTION_REVIEW",
      title: "Retention review requested",
      moduleCode: "aon-analytics",
      entityType: "employee",
      entityId: employeeId,
      assignedToRole,
      priority,
      description: `Flagged from AON & Attrition Analytics${riskBand ? ` — risk band: ${riskBand}` : ""}.`,
    });

    return res.json({ success: true, outcome });
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`
Expected: PASS

- [ ] **Step 5: Mount the router**

In `backend/src/app.ts`, add near the other `/api/reports/...` mounts (search for
`report-suite.routes` to find the right spot):

```typescript
import { aonRetentionFlagRouter } from "./modules/reporting/aon-retention-flag.routes.js";
```

```typescript
app.use("/api/reports/aon-analytics", aonRetentionFlagRouter);
```

- [ ] **Step 6: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon-retention-flag|app\.ts"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/aon-retention-flag.routes.ts backend/src/app.ts backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(reporting): Flag for Retention Review endpoint, reusing upsertOpenWorkItem

POST /api/reports/aon-analytics/flag-retention creates or refreshes an open
RETENTION_REVIEW work item via the existing shared workItem.ts helper -- no
new Work Inbox plumbing. Routed to the employee's reporting manager's role
when resolvable, else branch_head."
```

---

