/**
 * Grievance case history: real events only, and no wider than the case itself.
 *
 * NativeGrievanceCommandCenter has always requested
 * GET /api/helpdesk/grievances/:id/timeline alongside the detail call, inside a
 * Promise.allSettled — so the missing route produced no error, just a drawer with
 * no history. The route-contract gate is what surfaced it.
 *
 * Two properties matter beyond "it returns something":
 *
 * 1. Access control must match the detail route exactly. A timeline names the
 *    people who handled a case that may be anonymous, confidentiality-graded and
 *    anti-retaliation-flagged. A lighter check here would leak precisely what the
 *    grievance module exists to protect — and a blanket requireRole would cut an
 *    employee off from the history of their own case.
 *
 * 2. Every entry must come from a recorded timestamp. The row carries assigned_to
 *    but no assigned_at, and nothing audits the change, so assignment is absent
 *    rather than dated from updated_at. A plausible-but-wrong time in a case
 *    history is worse than an honest gap.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const routes = read("src/modules/helpdesk/helpdesk.routes.ts");
const service = read("src/modules/helpdesk/helpdesk.service.ts");

const timelineRoute = routes.slice(
  routes.indexOf('router.get("/grievances/:id/timeline"'),
  routes.indexOf('router.patch("/grievances/:id"'),
);
const detailRoute = routes.slice(
  routes.indexOf('router.get("/grievances/:id"'),
  routes.indexOf("// GET /grievances/:id/timeline"),
);
const timelineFn = service.slice(
  service.indexOf("async getGrievanceTimeline("),
  service.indexOf("async createGrievance("),
);

describe("the timeline route exists", () => {
  it("is registered under the helpdesk router", () => {
    expect(routes).toContain('router.get("/grievances/:id/timeline"');
  });

  it("returns { data } — the shape the drawer reads", () => {
    expect(timelineRoute).toContain("res.json({ data })");
  });
});

describe("it is no more readable than the grievance itself", () => {
  it("applies the same admin/hr check as the detail route", () => {
    // hasRole -> hasRoleForRequest: the demo-bypass-aware wrapper in shared/accessGuard.ts.
    // The assertion is unchanged in substance - both routes must run the identical admin/hr
    // check - only the name of the call they both make has moved.
    expect(timelineRoute).toContain('hasRoleForRequest(req.authUser, "admin", "hr")');
    expect(detailRoute).toContain('hasRoleForRequest(req.authUser, "admin", "hr")');
  });

  it("falls back to the same ownership check for everyone else", () => {
    for (const guard of ["getEmployeeForUser", "listGrievances", "Forbidden", "No employee record"]) {
      expect(timelineRoute).toContain(guard);
      expect(detailRoute).toContain(guard);
    }
  });

  it("is not behind a blanket requireRole, which would drop own-case access", () => {
    expect(timelineRoute).not.toContain("requireRole(");
  });
});

describe("every entry has a genuine timestamp", () => {
  it("draws audited actions from sensitive_action_log, scoped to this grievance", () => {
    expect(timelineFn).toContain("FROM sensitive_action_log");
    expect(timelineFn).toContain("s.entity_type = 'grievance' AND s.entity_id = ?");
    expect(timelineFn).toContain("s.acted_at");
  });

  it("adds only milestones the row actually stores", () => {
    for (const column of ["created_at", "resolved_at", "closed_at"]) {
      expect(timelineFn).toContain(column);
    }
  });

  it("never dates an event from updated_at", () => {
    // updated_at moves on any edit, so using it would misdate the history.
    expect(timelineFn).not.toContain("updated_at");
  });

  it("omits assignment, which has no recorded time", () => {
    expect(timelineFn).not.toContain("assigned_at");
    expect(timelineFn).not.toMatch(/GRIEVANCE_ASSIGNED/);
  });

  it("orders the merged result chronologically", () => {
    expect(timelineFn).toMatch(/\.sort\(/);
    expect(timelineFn).toContain("new Date(a.created_at as string).getTime()");
  });
});
