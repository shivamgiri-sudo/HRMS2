import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Screen (`GET /:code`) vs export (`GET /:code/export`) scoping parity.
 *
 * Two scoping functions exist in this module:
 *   - addScopedEmployeeFilters()  in reporting-access.ts        — branch ONLY.
 *   - appendScopeConditions()     in executors/types.ts          — branch AND process AND
 *                                                                   department AND cost centre.
 *
 * The export path always resolves ExecScope via resolveFullScope() and calls
 * appendScopeConditions() through the registered executor (executeReport() in
 * executors/index.ts). Several screen-route `case` blocks called the weaker
 * addScopedEmployeeFilters() for the SAME report code — or, for leave-trend-monthly, no
 * scope call at all — so a process-scoped viewer saw MORE data on screen than their own
 * export, or their actual access, allowed. Confirmed live 2026-08-19: 26 users hold
 * scope_type='process' in user_assignment_scope, and 1,016 active employees carry a
 * process_id that would be wrongly included or excluded depending on which path served the
 * request.
 *
 * Fixed 2026-08-19 by addFullScopedEmployeeFilters() in reporting-access.ts, which resolves
 * ExecScope and calls the SAME appendScopeConditions() the executor uses. This test is the
 * permanent guard: it does not merely check "some scope call exists" (inline-row-scope and
 * report-row-scope already do that) — it checks that these specific report codes, which have
 * already regressed once, use the FULL scoping call and not the weaker branch-only one.
 *
 * A ratchet, not a snapshot: CODES_REQUIRING_FULL_SCOPE may only grow.
 */
const CODES_REQUIRING_FULL_SCOPE = [
  "employee-master",
  "cost-centre-headcount",
  "lifecycle-events",
  "leave-allocation-register",
  "confirmation-due-list",
  "contract-expiry-list",
  "clearance-status-register",
  "leave-trend-monthly",
] as const;

describe("screen route matches export executor scoping for previously-mismatched reports", () => {
  const routes = read("src/modules/reporting/report-suite.routes.ts");

  /** Slice one `case "<code>"` block out of the switch (up to the next `case` at the same indent). */
  const screenBlock = (code: string): string => {
    const start = routes.indexOf(`case "${code}"`);
    expect(start, `${code}: no screen-route case block found`).toBeGreaterThan(-1);
    const next = routes.indexOf('\n    case "', start + 1);
    const defaultIdx = routes.indexOf("\n    default:", start + 1);
    let end = routes.length;
    if (next !== -1) end = Math.min(end, next);
    if (defaultIdx !== -1) end = Math.min(end, defaultIdx);
    return routes.slice(start, end);
  };

  it.each(CODES_REQUIRING_FULL_SCOPE)(
    "%s: screen route calls addFullScopedEmployeeFilters, not the branch-only helper",
    (code) => {
      const body = screenBlock(code);

      expect(
        body,
        `${code}: must call addFullScopedEmployeeFilters(req, clauses, params) — the same ` +
          `branch AND process AND department AND cost-centre scope the export executor for ` +
          `this code enforces via appendScopeConditions. See reporting-access.ts.`,
      ).toMatch(/addFullScopedEmployeeFilters\s*\(\s*req\s*,\s*clauses\s*,\s*params/);

      // The weaker helper must not ALSO be called on top of the full one — its presence here,
      // as a live (non-comment) call, is exactly the bug this guard exists to catch. Note
      // "addFullScopedEmployeeFilters" does not contain "addScopedEmployeeFilters" as a
      // substring (add + "Full" + "Scoped..." breaks the match), so this is safe against the
      // fix's own call.
      const weakCallOutsideComments = body
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(
        weakCallOutsideComments,
        `${code}: must not call the branch-only addScopedEmployeeFilters — it was the bug.`,
      ).not.toMatch(/addScopedEmployeeFilters\s*\(\s*req/);
    },
  );

  it("leave-trend-monthly's screen SQL joins employees so the scope predicate has something to bind to", () => {
    // This report had NO scope call at all — not even the weak branch-only one every other
    // case block had. Its FROM clause was leave_request/leave_type_master with no employees
    // join, so a scope predicate on e.branch_id/e.process_id/etc. would 500 the query. The
    // export executor (leaveTrendMonthly in executors/leave.executor.ts) joins `employees e`
    // purely to scope on, even though no employee column reaches its SELECT — the screen
    // route must do the same.
    const body = screenBlock("leave-trend-monthly");
    expect(body).toMatch(/JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*lr\.employee_id/i);
  });

  it("every code in this guard actually has a registered export executor calling appendScopeConditions", () => {
    // If an executor stopped calling appendScopeConditions, matching it on the screen side
    // would just propagate the export path's own regression. Guard both sides.
    const index = read("src/modules/reporting/executors/index.ts");
    const fnNames: Record<string, string> = {
      "employee-master": "employeeMaster",
      "cost-centre-headcount": "costCentreHeadcount",
      "lifecycle-events": "lifecycleEvents",
      "leave-allocation-register": "leaveAllocationRegister",
      "confirmation-due-list": "confirmationDueList",
      "contract-expiry-list": "contractExpiryList",
      "clearance-status-register": "clearanceStatusRegister",
      "leave-trend-monthly": "leaveTrendMonthly",
    };
    const executorFiles: Record<string, string> = {
      employeeMaster: "src/modules/reporting/executors/employee.executor.ts",
      costCentreHeadcount: "src/modules/reporting/executors/employee.executor.ts",
      lifecycleEvents: "src/modules/reporting/executors/employee.executor.ts",
      confirmationDueList: "src/modules/reporting/executors/employee.executor.ts",
      contractExpiryList: "src/modules/reporting/executors/employee.executor.ts",
      leaveAllocationRegister: "src/modules/reporting/executors/leave.executor.ts",
      leaveTrendMonthly: "src/modules/reporting/executors/leave.executor.ts",
      clearanceStatusRegister: "src/modules/reporting/executors/exit.executor.ts",
    };

    for (const code of CODES_REQUIRING_FULL_SCOPE) {
      const fnName = fnNames[code];
      expect(index, `${code}: not registered in executors/index.ts`).toContain(`"${code}"`);
      const fileSrc = read(executorFiles[fnName]);
      const start = fileSrc.indexOf(`export async function ${fnName}`);
      expect(start, `${fnName} (export executor for ${code}) not found`).toBeGreaterThan(-1);
      const nextFn = fileSrc.indexOf("\nexport async function", start + 1);
      const fn = fileSrc.slice(start, nextFn === -1 ? fileSrc.length : nextFn);
      expect(
        fn,
        `${fnName}: export executor for ${code} no longer calls appendScopeConditions — ` +
          `fix the executor, then re-check the screen-route side stays matched.`,
      ).toMatch(/appendScopeConditions\s*\(/);
    }
  });
});
