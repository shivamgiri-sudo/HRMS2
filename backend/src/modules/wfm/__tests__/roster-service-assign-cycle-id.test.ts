import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above ordinary const declarations, so the
// mocks they reference must be created via vi.hoisted (same pattern already
// proven in roster-service-audit-log.test.ts).
const { executeMock, getConnectionMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getConnectionMock: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: executeMock, getConnection: getConnectionMock },
}));

// Corrected (2026-08-20 retry): roster.service.ts imports checkEmployeeDateNotLocked
// from "../roster/roster-lock-guard.js" (roster.service.ts:7), which resolves to
// backend/src/modules/roster/roster-lock-guard.ts — not a same-directory sibling
// of roster.service.ts. From this test file the equivalent path is
// "../../roster/roster-lock-guard.js".
vi.mock("../../roster/roster-lock-guard.js", () => ({
  checkEmployeeDateNotLocked: vi.fn().mockResolvedValue({ blocked: false }),
}));

// withEmployeeRosterLock, rest-policy, and lock-guard helpers are exercised by
// existing tests for assignEmployee already — this test only asserts the new
// cycleId behavior, so those are mocked to their pass-through/no-op paths.
//
// Corrected (2026-08-20 retry): roster.service.ts imports withEmployeeRosterLock
// from "./rest-policy.service.js" (confirmed at roster.service.ts:6), not from a
// "../roster-concurrency.util.js" module — no such file exists. Folded into the
// same mock factory as isRestPolicyFeatureActive, mirroring the working pattern
// already proven in roster-service-audit-log.test.ts.
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn().mockResolvedValue(false),
  withEmployeeRosterLock: (_employeeId: string, fn: (conn: unknown) => unknown) =>
    fn({ execute: executeMock }),
}));

import { __resetSchemaCachesForTests } from "../shift-scheduling.util.js";
import { rosterService } from "../roster.service.js";

describe("assignEmployee — additive cycleId", () => {
  beforeEach(() => {
    executeMock.mockReset();
    // rosterAssignmentColumns() caches its DB column probe at module scope;
    // reset it before every test case so each test's fresh probe mock is what
    // actually gets consumed, rather than a stale cache from a prior test.
    __resetSchemaCachesForTests();
    // rosterAssignmentColumns() probe: include cycle_id, exclude versioning cols for simplicity
    executeMock.mockResolvedValueOnce([[{ COLUMN_NAME: "cycle_id" }, { COLUMN_NAME: "id" }], undefined]);
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT
    executeMock.mockResolvedValueOnce([[{ id: "assignment-1", cycle_id: "cycle-1" }], undefined]); // SELECT back
  });

  it("writes cycle_id when provided", async () => {
    await rosterService.assignEmployee(
      { employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1" },
      "user-1"
    );
    const insertCall = executeMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO wfm_roster_assignment"));
    expect(insertCall).toBeTruthy();
    expect(String(insertCall![0])).toContain("cycle_id");
    expect(insertCall![1]).toContain("cycle-1");
  });

  it("omits cycle_id entirely when not provided (existing-caller regression guard)", async () => {
    await rosterService.assignEmployee(
      { employeeId: "emp-1", rosterDate: "2026-08-24" },
      "user-1"
    );
    const insertCall = executeMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO wfm_roster_assignment"));
    expect(String(insertCall![0])).not.toContain("cycle_id");
  });
});
