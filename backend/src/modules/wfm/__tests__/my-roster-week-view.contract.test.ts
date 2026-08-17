import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Section A of the 2026-08-17 go-live closure — "My Roster" convergence.
 *
 * NativeMyRoster.tsx called /api/roster-gov/*, which reads roster_daily_assignment —
 * verified live 2026-08-17: **0 rows**. Every real roster assignment (413,386 rows) lives in
 * wfm_roster_assignment, whose employee-acknowledgement chain was wired the day before
 * (roster-employee-ack-producer.contract.test.ts) but had no frontend caller. Employees saw
 * an empty "My Roster" page.
 *
 * A cycle-based repoint would not have fixed this either: of those 413,386 rows, 412,032
 * (99.7%, verified live) have cycle_id = NULL — they come from the legacy plan_id roster
 * engines, not the cycle-based generator. GET /my-roster/weeks and GET /my-roster/week/:d
 * read by (employee_id, roster_date) instead, so both populations are visible.
 *
 * Employee acknowledgement itself still only applies to rows a manager has actually
 * published into the ack chain (final_roster_status = 'pending_employee_ack'). Legacy rows
 * still sitting in 'generated' are reported read-only ('draft'/'not_published') rather than
 * carrying a false acknowledge affordance on data nobody ever asked the employee to confirm.
 *
 * Source-text assertions, matching the convention already used for wfm.routes.ts's other
 * large inline Express handlers (see roster-employee-ack-producer.contract.test.ts).
 */
const SRC = readFileSync(resolve(__dirname, "../wfm.routes.ts"), "utf8");

describe("GET /my-roster/weeks reads by date range, not cycle_id", () => {
  const block = SRC.slice(SRC.indexOf('"/my-roster/weeks"'), SRC.indexOf('"/my-roster/week/:weekStart"'));

  it("is scoped to the authenticated employee", () => {
    expect(block).toMatch(/getEmployeeForUser\(req\.authUser!\.id\)/);
    expect(block).toMatch(/WHERE employee_id = \?/);
  });

  it("groups by the Monday of each week, not by cycle_id", () => {
    expect(block).toMatch(/DATE_SUB\(roster_date, INTERVAL WEEKDAY\(roster_date\) DAY\)/);
    expect(block).not.toMatch(/GROUP BY cycle_id/);
  });

  it("bounds the window rather than scanning the whole table", () => {
    expect(block).toMatch(/DATE_SUB\(CURDATE\(\), INTERVAL 8 WEEK\)/);
    expect(block).toMatch(/DATE_ADD\(CURDATE\(\), INTERVAL 4 WEEK\)/);
  });

  it("reports a week as 'draft' (not 'published') when nothing in it ever left 'generated'", () => {
    // This is the guard against the false affordance: a week where every row is still
    // 'generated' must not be reported as something NativeMyRoster.tsx treats as
    // ack-eligible ("published"/"acknowledged"/"active"), or the UI shows Ack/Dispute
    // buttons for assignments the backend will 409 on.
    expect(block).toMatch(/non_generated_count.*===\s*0\s*\n?\s*\?\s*"draft"/s);
  });

  it("reports 'acknowledged' only when every row in the week has reached a terminal state", () => {
    expect(block).toMatch(/terminal_count.*===\s*Number\(r\.total_count\)\s*\?\s*"acknowledged"\s*:\s*"published"/s);
  });
});

describe("GET /my-roster/week/:weekStart reads shift + status for the 7 days", () => {
  const block = SRC.slice(SRC.indexOf('"/my-roster/week/:weekStart"'), SRC.indexOf('wfmRouter.get("/my-weekoff"'));

  it("is scoped to the authenticated employee and validates the date param", () => {
    expect(block).toMatch(/getEmployeeForUser\(req\.authUser!\.id\)/);
    expect(block).toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}/);
    expect(block).toMatch(/WHERE wra\.employee_id = \?/);
  });

  it("falls back from the new shift template to the legacy shift master", () => {
    // shift_template_id is only populated by the cycle-based generator; shift_id (the legacy
    // FK to wfm_shift_master) is what the 412,032 cycle_id-less rows actually carry.
    expect(block).toMatch(/COALESCE\(wst\.shift_name, wsm\.shift_name\)/);
    expect(block).toMatch(/LEFT JOIN wfm_shift_template wst ON wst\.id = wra\.shift_template_id/);
    expect(block).toMatch(/LEFT JOIN wfm_shift_master wsm ON wsm\.id = wra\.shift_id/);
  });

  it("never reports a legacy 'generated' row as pending/acknowledged/disputed", () => {
    // mapAckStatus's fourth branch is the one that matters: anything not in the ack-terminal,
    // ack-disputed or pending_employee_ack sets must not collapse into "pending" (which would
    // trigger NativeMyRoster.tsx's amber "needs acknowledgement" banner on data that was
    // never published for acknowledgement).
    const fn = SRC.slice(SRC.indexOf("function mapAckStatus"), SRC.indexOf("function mapAckStatus") + 500);
    expect(fn).toMatch(/return "not_published"/);
  });
});

describe("NativeMyRoster.tsx no longer calls the empty roster-gov table", () => {
  const FRONTEND = readFileSync(
    resolve(__dirname, "../../../../../src/pages/NativeMyRoster.tsx"),
    "utf8",
  );

  it("calls the WFM-canonical week endpoints", () => {
    expect(FRONTEND).toMatch(/\/api\/wfm\/my-roster\/weeks/);
    expect(FRONTEND).toMatch(/\/api\/wfm\/my-roster\/week\//);
  });

  it("acknowledges and disputes through /api/wfm/my-weekoff, not /api/roster-gov", () => {
    expect(FRONTEND).toMatch(/\/api\/wfm\/my-weekoff\/\$\{.*\}\/acknowledge/);
    expect(FRONTEND).toMatch(/\/api\/wfm\/my-weekoff\/\$\{.*\}\/reject/);
    expect(FRONTEND).not.toMatch(/\/api\/roster-gov/);
  });

  it("sends a reason of least 5 characters to /reject, matching the backend's own guard", () => {
    expect(FRONTEND).toMatch(/reason\.trim\(\)\.length < 5/);
  });
});
