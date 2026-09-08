/**
 * Guards the ways payroll sub-tab RBAC silently stopped working.
 *
 * RBAC resolves one page code per URL: ProtectedRoute reads PAGE_CODE_BY_ROUTE for the
 * pathname, WorkforcePageGate checks the code the route passes it. A tab is not a URL. When
 * payroll screens were merged into tabbed pages, N page codes collapsed into 1 and the folded
 * screens' codes kept their grants while nothing consulted them any more.
 *
 * Three ratchets here:
 *
 *   1. A merged page's tab must be gated on the page code its screen used before the merge.
 *      Pinned per page, so folding another screen into one of these tabs without wiring its
 *      code fails here rather than in production.
 *
 *   2. A page code that was retired BECAUSE of a merge is never revived as a gate. Not every
 *      folded code is reusable: PAYROLL_DISBURSAL had all its grants deactivated in
 *      production by migration 1605, so gating on it would lock the surface rather than
 *      scope it.
 *
 *   3. A payroll route must not carry a roles={[...]} list that ProtectedRoute will ignore.
 *      ProtectedRoute checks the role list only when the path resolves to NO page code
 *      (`if (!routePageCode && roles …)`), so on a mapped route the list is dead code that
 *      reads exactly like enforcement. 33 of 42 payroll routes are in that state today; the
 *      count is pinned so it can fall but never rise.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRoutePageCode } from "@/lib/pageRoutePageCodes";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

/**
 * Every merged payroll page, and the page code each of its tabs must be gated on.
 * The codes are the ones the folded screens carried before the merge — none was invented
 * for this, and each still has grants in role_page_access.
 */
const MERGED_PAGE_TABS: Record<string, Record<string, string>> = {
  "src/pages/payroll/PfManagement.tsx": {
    queue: "PAYROLL_PF_CREATION_QUEUE",
    batches: "PAYROLL_PF_BATCHES",
  },
  "src/pages/payroll/HolidayWork.tsx": {
    submit: "PAYROLL_HOLIDAY_WORK_REQUESTS",
    approvals: "PAYROLL_HOLIDAY_WORK_APPROVALS",
  },
  "src/pages/payroll/PayrollReadinessDashboard.tsx": {
    branch: "PAYROLL_BRANCH_READINESS",
    process: "PAYROLL_PROCESS_READINESS",
  },
  "src/pages/payroll/StatutoryCenter.tsx": {
    filing: "PAYROLL_STATUTORY_FILING",
    config: "STATUTORY_CONFIG",
  },
};

/**
 * Payroll routes whose roles={[...]} list ProtectedRoute ignores because the path resolves to
 * a page code. Measured at 33 when per-tab gating was added. It may fall — deleting a dead
 * list, or removing a route — but a rise means someone wrote a role list believing it guards
 * something.
 */
const DEAD_ROLE_LIST_ROUTE_BUDGET = 33;

describe("payroll merged pages gate each tab on its own page code", () => {
  for (const [file, tabs] of Object.entries(MERGED_PAGE_TABS)) {
    const source = read(file);

    it(`${file} routes its tabs through useTabAccess`, () => {
      expect(source).toContain("useTabAccess");
    });

    for (const [tab, pageCode] of Object.entries(tabs)) {
      it(`${file} gates the "${tab}" tab on ${pageCode}`, () => {
        // The mapping is declared as `tab: "PAGE_CODE"` in the useTabAccess call.
        const declaration = new RegExp(`\\b${tab}\\s*:\\s*"${pageCode}"`);
        expect(source).toMatch(declaration);
      });
    }
  }
});

/**
 * PAYROLL_DISBURSAL is retired, not merely unused: migration 1605 deactivated every grant on
 * it in production on 2026-08-25 with explicit owner approval, because the Payment Center
 * merge left it dangling. Gating anything on it would hide that surface from everyone but
 * super_admin, and re-granting it would undo an approved decision. Narrowing disbursal below
 * PAYROLL_BANK_READINESS needs a new page code, not this one.
 */
describe("retired payroll page codes are not revived as gates", () => {
  const RETIRED = ["PAYROLL_DISBURSAL"];
  const sources = [
    "src/pages/payroll/PaymentDisbursalCenter.tsx",
    "src/config/routes/payroll.routes.tsx",
  ];

  for (const code of RETIRED) {
    for (const file of sources) {
      it(`${file} does not gate on ${code}`, () => {
        const source = read(file);
        // Allowed in prose explaining why it is retired; not as a gate or tab mapping.
        expect(source).not.toMatch(new RegExp(`(pageCode|Gate)\\s*=\\s*"${code}"`));
        expect(source).not.toMatch(new RegExp(`\\w+\\s*:\\s*"${code}"`));
      });
    }
  }
});

describe("payroll routes do not rely on role lists ProtectedRoute ignores", () => {
  const routeSource = read("src/config/routes/payroll.routes.tsx");

  const routesWithDeadRoleList = [...routeSource.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)\/>/g)]
    .filter(([, , body]) => !/Navigate|Redirect/.test(body))
    .filter(([, , body]) => /roles=\{\[/.test(body))
    .map(([, path]) => path)
    .filter((path) => getRoutePageCode(path) !== undefined);

  it("does not grow the set of routes whose roles= list is dead code", () => {
    expect(routesWithDeadRoleList.length).toBeLessThanOrEqual(DEAD_ROLE_LIST_ROUTE_BUDGET);
  });

  it("every payroll route is gated by a page code or a role list, never neither", () => {
    const ungated = [...routeSource.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)\/>/g)]
      .filter(([, , body]) => !/Navigate|Redirect/.test(body))
      .filter(([, path, body]) => !/Gate pageCode=/.test(body) && getRoutePageCode(path) === undefined)
      .map(([, path]) => path);

    expect(ungated).toEqual([]);
  });
});
