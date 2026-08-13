import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * GET /api/leave/requests/my — the dashboard activity feed.
 *
 * The feed has always called this route and it never existed, so every load 404'd. It uses
 * Promise.allSettled, so the rejection was absorbed and leave simply never appeared in a
 * user's recent activity: no error, just a feed quietly missing half of what it promised.
 *
 * These are source assertions rather than behavioural ones because tests/leave.service.test.ts
 * mocks the database and its mocks have drifted from the current queries — 10 of its tests
 * already fail on main, before this route existed. Asserting through those mocks would prove
 * nothing about the route. Behaviour is verified against the running backend instead.
 */
const ROOT = resolve(__dirname, "../../../..");
const routes = readFileSync(join(ROOT, "src/modules/leave/leave.routes.ts"), "utf8");
const service = readFileSync(join(ROOT, "src/modules/leave/leave.service.ts"), "utf8");

describe("GET /leave/requests/my", () => {
  it("is registered", () => {
    expect(routes).toContain('leaveRouter.get("/requests/my"');
  });

  it("is registered before any /requests/:param route, so 'my' is never read as an id", () => {
    // Express matches in registration order. Behind /requests/:id/review, the literal path
    // would bind :id = "my" and look up a leave request with that id.
    const my = routes.indexOf('"/requests/my"');
    const firstParam = routes.search(/"\/requests\/:[a-zA-Z]/);
    expect(my).toBeGreaterThan(-1);
    if (firstParam > -1) expect(my).toBeLessThan(firstParam);
  });

  it("forces employeeId to the caller, so the result cannot widen with the caller's role", () => {
    // GET /requests deliberately widens for privileged roles — an admin gets their whole
    // branch. That is not what "my recent activity" means, so this route must pin the
    // employee to the caller for everyone, not only for unprivileged users.
    // Boundary is GET /requests/legacy, the next distinct route after /requests/my
    // in the file — GET /requests and PATCH /requests/:id/review (which used to sit
    // between them) were removed as dead code: leaveSecureRouter is mounted first in
    // app.ts and always won for both paths. (2026-08-13 audit)
    const handler = routes.slice(
      routes.indexOf('leaveRouter.get("/requests/my"'),
      routes.indexOf('leaveRouter.get("/requests/legacy"')
    );
    expect(handler).toContain("getEmployeeForUser(req.authUser!.id)");
    expect(handler).toContain("query.employeeId = callerEmp.id");
    // No privilege branch here — that is what would let the scope widen.
    expect(handler).not.toContain("isLeavePrivileged");
  });

  it("answers a login with no employee record with an empty feed, not an error", () => {
    // Boundary is GET /requests/legacy, the next distinct route after /requests/my
    // in the file — GET /requests and PATCH /requests/:id/review (which used to sit
    // between them) were removed as dead code: leaveSecureRouter is mounted first in
    // app.ts and always won for both paths. (2026-08-13 audit)
    const handler = routes.slice(
      routes.indexOf('leaveRouter.get("/requests/my"'),
      routes.indexOf('leaveRouter.get("/requests/legacy"')
    );
    expect(handler).toMatch(/if \(!callerEmp\) return res\.json\(\{\s*success: true, data: \[\], total: 0/);
  });

  it("still sits behind the router's authentication", () => {
    // leaveRouter.use(requireAuth) covers every route on this router; "my" is meaningless
    // without an authenticated caller.
    expect(routes).toContain("leaveRouter.use(requireAuth)");
  });
});

describe("leaveService.listRequests", () => {
  it("returns the leave type name, so the feed does not label everything 'Leave'", () => {
    // leave_request stores only leave_type_id and leave_type_code. The feed reads
    // `req.leave_type ?? req.type ?? "Leave"`, so without a name every entry read "Leave".
    expect(service).toContain("lt.leave_name AS leave_type");
    expect(service).toContain("LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id");
  });

  it("keeps every existing field, so the join cannot break current callers", () => {
    expect(service).toContain("SELECT lr.*");
  });

  it("qualifies every filter with lr., since the joined table also has created_at", () => {
    // Unqualified column names would be ambiguous once leave_type_master is joined, and
    // MySQL would reject the query rather than filter wrongly.
    for (const condition of [
      "lr.employee_id = ?",
      "lr.leave_type_id = ?",
      "lr.status = ?",
      "lr.from_date >= ?",
      "lr.to_date <= ?",
    ]) {
      expect(service).toContain(condition);
    }
    expect(service).toContain("FROM leave_request lr");
    expect(service).toContain("COUNT(*) AS total FROM leave_request lr");
  });
});
