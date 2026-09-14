import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * GET /api/wfm/attendance/breaks?recordIds=a,b,c
 *
 * The profile's attendance history has always called this route and it never existed, so it
 * 404'd on every load and break details never appeared for anyone.
 *
 * The two things that matter here are both invisible at the type level:
 *
 *   1. recordIds come from the client. Without an employee_id filter, anyone could pass
 *      another person's attendance ids and read when and where they took breaks.
 *   2. The caller casts the response straight to AttendanceBreak[] and filters on
 *      attendance_record_id. Returning raw wfm_break_log columns would leave every filter
 *      matching nothing, so breaks would look absent rather than erroring — the same silent
 *      failure this route was added to remove.
 */
const ROOT = resolve(__dirname, "../../../..");
const routes = readFileSync(join(ROOT, "src/modules/wfm/wfm.routes.ts"), "utf8");

const handler = routes.slice(
  routes.indexOf('wfmRouter.get("/attendance/breaks"'),
  routes.indexOf('wfmRouter.patch("/breaks/:breakId/end"')
);

describe("GET /wfm/attendance/breaks", () => {
  it("is registered", () => {
    expect(routes).toContain('wfmRouter.get("/attendance/breaks"');
    expect(handler.length).toBeGreaterThan(0);
  });

  it("restricts the query to the caller's own employee", () => {
    // The security control. Client-supplied ids are never trusted on their own.
    expect(handler).toContain("getEmployeeForUser(req.authUser!.id)");
    expect(handler).toContain("AND employee_id = ?");
    expect(handler).toContain("callerEmp.id");
  });

  it("parameterises the id list rather than interpolating it", () => {
    expect(handler).toContain('recordIds.map(() => "?").join(",")');
    expect(handler).toContain("session_id IN (${placeholders})");
  });

  it("bounds the number of ids so the IN list cannot grow without limit", () => {
    expect(handler).toContain("slice(0, MAX_BREAK_RECORD_IDS)");
    expect(routes).toMatch(/MAX_BREAK_RECORD_IDS = \d+/);
  });

  it("returns the field names the client reads, not the raw table columns", () => {
    // wfm_break_log stores session_id / break_start / break_end. The client filters on
    // attendance_record_id and renders pause_time and resume_time, and applies no mapping
    // of its own, unlike useBreaksForRecord.
    expect(handler).toContain("attendance_record_id: row.session_id");
    expect(handler).toContain("pause_time: row.break_start");
    expect(handler).toContain("resume_time: row.break_end ?? null");
  });

  it("answers an empty or absent recordIds with an empty list, not an error", () => {
    // The caller guards with enabled: recordIds.length > 0, but a page with no attendance
    // rows must not produce a 400 if that guard ever changes.
    expect(handler).toContain("if (recordIds.length === 0) return res.json({ success: true, data: [] })");
  });

  it("answers a login with no employee record with an empty list", () => {
    expect(handler).toContain("if (!callerEmp) return res.json({ success: true, data: [] })");
  });

  it("sits behind the router's authentication", () => {
    expect(routes).toContain("wfmRouter.use(requireAuth)");
  });

  it("is reachable despite /attendance being delegated to the APR sub-router", () => {
    // wfmRouter.use("/attendance", attendanceAprBulkRouter) runs first. Express falls through
    // to this route only because that sub-router registers no /breaks path; if it ever does,
    // it will shadow this one.
    const apr = readFileSync(join(ROOT, "src/modules/wfm/attendance-apr-bulk.routes.ts"), "utf8");
    expect(apr).not.toMatch(/["'`]\/breaks/);
  });
});
