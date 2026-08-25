# Task 7 Brief: RBAC-scoped scorecard route

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 7)

## IMPORTANT correction to the plan document's role list

The plan's original Task 7 code used `requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "team_leader", "assistant_manager", "wfm", "super_admin")`. **Do NOT use this list as-is.** A security review during Task 5 of this same plan found that `admin` must NOT get broad access to this feature — `backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts` documents a deliberate 2026-08-22 production incident fix restricting the `admin` role to `EMPLOYEE_SELF_DASHBOARD` only (8 real users with that role could previously open nothing, and a broader grant was reverted). `wfm` was also excluded from this feature's dashboard registry entry for the same reason (not part of the approved role set).

The CORRECT role set for this route (matching the now-approved `backend/src/shared/dashboardAccessRegistry.ts`'s `PERFORMANCE_SCORECARD` entry) is:
`manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo, management, super_admin`

Before writing the route, read that registry entry yourself (`grep -n "PERFORMANCE_SCORECARD" backend/src/shared/dashboardAccessRegistry.ts` then read the surrounding lines) to confirm the exact current role list, and read how `requireRole(...)` is actually called in an existing route (e.g. `backend/src/modules/management/management.routes.ts`'s `agent-performance` route) to confirm `requireRole`'s expected role-string format matches these same role keys (it should, but verify — do not assume `requireRole` and `allowedRoleKeys` use identical spellings without checking, since `dashboardAccessRegistry.ts` has a `normalizeDashboardRole` alias layer that `requireRole` may not share).

## Global Constraints (binding on this task)

- `hrmsApi` callers always pass paths starting with `/api/...` — not directly relevant to this backend task, but the route you create must be mountable at exactly `/api/performance-scorecard` for the frontend tasks that follow.

## Task

**Files:**
- Create: `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`
- Modify: the route mount file (find it: `grep -rn "management.routes" backend/src --include=*.ts` to find where `management.routes.ts` is mounted with `app.use(...)`, and mount your new router the same way)
- Test: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts`

**Interfaces:**
- Consumes: `resolveTeamScope` — find this in `backend/src/modules/management/management.routes.ts` or `management.service.ts` (it's used by the existing `agent-performance` route to determine `{ employeeIds, isWide }` for the caller). Confirm its exact export location and signature before importing it.
- Produces: `GET /api/performance-scorecard?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` → `{ success: true, data: [...] }` rows from `employee_performance_daily_snapshot` (Task 1's table), scoped by the caller's role — consumed by a later frontend task (not part of this task).

- [ ] **Step 1: Read the reference route first**

Read `backend/src/modules/management/management.routes.ts`'s `agent-performance` route in full (imports, `requireRole` usage, `resolveTeamScope` call, response shape) — this task's route follows the same RBAC-scoping pattern, just against a different table.

- [ ] **Step 2: Write the failing test**

Use this repo's real test framework/conventions (check an existing route test file for the exact auth-mocking pattern — this repo uses a demo-token auth convention per project memory, confirm the real mechanism by reading an existing route test under `backend/src/modules/*/​__tests__/*.routes.test.ts`).

```ts
// backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
// (illustrative — adapt to this repo's real test/auth-mocking conventions found in Step 1's reference route's own test file, if one exists)
describe("GET /api/performance-scorecard", () => {
  it("returns snapshot rows scoped to the caller's manager chain", async () => {
    // mock db.execute to return one row: { employee_id: "emp-1", snapshot_date: "2026-08-24", attendance_status: "present" }
    // make an authenticated GET request as a manager-role account
    // expect 200, success:true, data with length 1
  });

  it("returns 400 when dateFrom or dateTo is missing", async () => {
    // GET without query params, expect 400
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL because the route module doesn't exist yet.

- [ ] **Step 4: Write the route**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
import { Router, type Response } from "express";
import { db } from "PLACEHOLDER_CONFIRM_REAL_DB_IMPORT_PATH.js"; // same path used elsewhere in this module (Task 2 already confirmed it — check that file)
import { h } from "PLACEHOLDER_CONFIRM.js"; // match the exact async-handler wrapper import used in management.routes.ts
import { requireRole } from "PLACEHOLDER_CONFIRM.js"; // match the exact import used in management.routes.ts
import { resolveTeamScope } from "../management/management.service.js"; // CONFIRM this is the real export location
import type { AuthenticatedRequest } from "PLACEHOLDER_CONFIRM.js"; // match the exact type import used in management.routes.ts

const router = Router();

router.get(
  "/",
  requireRole("manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ success: false, message: "dateFrom and dateTo are required" });
    }
    const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);

    const conds = ["s.snapshot_date BETWEEN ? AND ?"];
    const params: unknown[] = [dateFrom, dateTo];
    if (!isWide && employeeIds && employeeIds.length > 0) {
      conds.push(`s.employee_id IN (${employeeIds.map(() => "?").join(",")})`);
      params.push(...employeeIds);
    }

    const [rows] = (await db.execute(
      `SELECT e.id AS employeeId, e.full_name AS employeeName, e.employee_code AS employeeCode,
              s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
              s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
              s.pip_status AS pipStatus, s.designation_id AS designationId,
              s.quality_score AS qualityScore, s.template_metrics AS templateMetrics,
              s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
              s.team_revenue AS teamRevenue
         FROM employee_performance_daily_snapshot s
         JOIN employees e ON e.id = s.employee_id
        WHERE ${conds.join(" AND ")}
        ORDER BY e.full_name ASC, s.snapshot_date ASC
        LIMIT 5000`,
      params,
    )) as any;

    res.json({ success: true, data: rows });
  }),
);

export default router;
```
Replace all `PLACEHOLDER_CONFIRM*` imports with the real paths/names found in Step 1. IMPORTANT: the `requireRole(...)` list above uses the CORRECTED role set from the top of this brief, NOT the plan document's original (which wrongly included `admin`/`wfm`) — do not change it back.

If `resolveTeamScope` turns out not to exist at `../management/management.service.js` or has a different signature than `(userId) => Promise<{ employeeIds, isWide }>`, adapt to its real signature — do not invent a function that doesn't exist.

- [ ] **Step 5: Mount the router**

Open the file where `management.routes.ts` is mounted (found via the grep in the Files section above), and add, following the exact same pattern used for the management router:
```ts
import performanceScorecardRoutes from "./modules/performance-scorecard/performance-scorecard.routes.js"; // adjust relative path to match the mount file's actual location
// ... alongside app.use("/api/management", managementRoutes):
app.use("/api/performance-scorecard", performanceScorecardRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Expected: PASS on both cases.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/performance-scorecard/performance-scorecard.routes.ts backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts <the mount file you edited>
git commit -m "feat: add RBAC-scoped GET /api/performance-scorecard route"
```
Stage only these explicit files (the 2 new files plus the one mount-file edit). `git status --short` first, confirm nothing else is staged — the mount file is likely a hot, frequently-touched file shared with many other routes.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-7-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree, especially the route-mount file. `git fetch` + re-check `git log` before committing; stage only your explicit files.
- Do not touch any file outside this task's file list.
- The `requireRole` role list is security-sensitive — do not add `admin` or `wfm` back in, and do not add any other role beyond the corrected list given above, even if it seems convenient. If you believe a role is missing, flag it in your report as a concern rather than adding it unilaterally.
- If you have questions before starting, ask them instead of guessing.
