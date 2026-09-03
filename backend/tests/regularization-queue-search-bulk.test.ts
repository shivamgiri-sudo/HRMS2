import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cover for the two gaps the owner reported on /attendance-regularization
 * (2026-09-03): no employee search, and a bulk-approve control that never
 * enabled.
 *
 * The bulk one was not a UI oversight. `canBulkApprove` was computed as
 * `riskLevel === "low" && status === "manager_approved"`, with no reference to
 * who was asking — and live `attendance_regularization` holds 209 open requests,
 * every one of them at `pending`, with no row anywhere at `manager_approved`. The
 * flag was therefore false for every row in the database, so the button sat
 * disabled at (0) forever. These tests pin the replacement to the stage machine
 * the write path uses, so the two cannot drift apart again.
 */

vi.mock("../src/shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(),
  hasScopedAccess: vi.fn().mockResolvedValue(false),
  getUserAssignmentScopes: vi.fn().mockResolvedValue([]),
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));
vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "caller-emp" }),
  hasRole: vi.fn().mockResolvedValue(false),
}));
vi.mock("../src/shared/approvalEscalation.js", () => ({
  resolveEffectiveApprover: vi.fn().mockResolvedValue({ approverId: null }),
}));

const { db } = await import("../src/db/mysql.js");
const { hasAnyRole } = await import("../src/shared/scopeAccess.js");
const { wfmRegularizationSecureRouter } = await import(
  "../src/modules/wfm/wfm.regularization.secure.routes.js"
);

const execute = db.execute as unknown as ReturnType<typeof vi.fn>;
const roleCheck = hasAnyRole as unknown as ReturnType<typeof vi.fn>;

/** One live-shaped row: a `pending` request with nothing that scores risk. */
function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    employee_id: "emp-1",
    status: "pending",
    session_date: "2026-08-20",
    requested_status: "present",
    current_attendance_status: "absent",
    total_punches: 2,
    same_day_request_count: 0,
    recent_request_count: 0,
    attendance_locked: 0,
    mismatch_flag: 0,
    ...over,
  };
}

/** Invokes the GET /regularizations handler directly, no HTTP server. */
async function callList(query: Record<string, string> = {}) {
  const layer = (wfmRegularizationSecureRouter as any).stack.find(
    (l: any) => l.route?.path === "/regularizations" && l.route?.methods?.get,
  );
  expect(layer, "GET /regularizations must be registered").toBeTruthy();

  let payload: any = null;
  const res: any = {
    status() { return res; },
    json(body: any) { payload = body; return res; },
  };
  const req: any = { query, body: {}, authUser: { id: "user-1" }, params: {} };
  await layer.route.stack[0].handle(req, res, (err: unknown) => { if (err) throw err; });
  return payload;
}

beforeEach(() => {
  execute.mockReset();
  roleCheck.mockReset();
  roleCheck.mockResolvedValue(false);
  // count query, then the list query
  execute.mockResolvedValueOnce([[{ total: 1 }], []]).mockResolvedValue([[pendingRow()], []]);
});

describe("employee search", () => {
  it("pushes the term into the SQL rather than filtering an already-truncated page", async () => {
    await callList({ search: "Sheelu" });

    const [countSql, countParams] = execute.mock.calls[0];
    expect(String(countSql)).toMatch(/LIKE \?/);
    expect(countParams).toContain("%Sheelu%");

    // Applied to the count too, or the pager would report a total for a different
    // filter than the rows it is paging.
    const [listSql] = execute.mock.calls[1];
    expect(String(listSql)).toMatch(/LIKE \?/);
  });

  it("matches employee code as well as name", async () => {
    await callList({ search: "MAS123" });
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/employee_code LIKE \?/);
    expect(params.filter((p: unknown) => p === "%MAS123%")).toHaveLength(2);
  });

  it("adds no clause when the box is empty", async () => {
    await callList({ search: "   " });
    const [, params] = execute.mock.calls[0];
    expect(params.some((p: unknown) => String(p).includes("%"))).toBe(false);
  });
});

describe("canApproveNow / canBulkApprove", () => {
  it("is true for a super_admin on a pending row — the case that was permanently false", async () => {
    roleCheck.mockImplementation(async (_u: string, ...roles: string[]) =>
      roles.includes("super_admin"),
    );

    const body = await callList();
    const support = body.data[0].decision_support;
    expect(support.canApproveNow).toBe(true);
    expect(support.riskLevel).toBe("low");
    expect(support.canBulkApprove).toBe(true);
  });

  it("stays false for WFM on a pending row — the manager stage comes first", async () => {
    roleCheck.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("wfm"));

    const body = await callList();
    expect(body.data[0].decision_support.canApproveNow).toBe(false);
  });

  it("turns true for WFM once the manager has approved", async () => {
    roleCheck.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("wfm"));
    execute.mockReset();
    execute
      .mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValue([[pendingRow({ status: "manager_approved" })], []]);

    const body = await callList();
    expect(body.data[0].decision_support.canApproveNow).toBe(true);
  });

  it("is false on an approved row for everyone — approving twice rewrites the snapshot", async () => {
    roleCheck.mockImplementation(async (_u: string, ...roles: string[]) =>
      roles.includes("super_admin"),
    );
    execute.mockReset();
    execute
      .mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValue([[pendingRow({ status: "approved" })], []]);

    const body = await callList();
    expect(body.data[0].decision_support.canApproveNow).toBe(false);
  });

  it("keeps a risk-flagged row out of the SAFE sweep while leaving it approvable", async () => {
    roleCheck.mockImplementation(async (_u: string, ...roles: string[]) =>
      roles.includes("super_admin"),
    );
    execute.mockReset();
    execute.mockResolvedValueOnce([[{ total: 1 }], []]).mockResolvedValue([
      // present with zero punches (+45) and a locked day (+30) => high risk
      [pendingRow({ total_punches: 0, attendance_locked: 1 })],
      [],
    ]);

    const body = await callList();
    const support = body.data[0].decision_support;
    expect(support.riskLevel).not.toBe("low");
    expect(support.canApproveNow).toBe(true);
    expect(support.canBulkApprove).toBe(false);
  });

  it("grants nothing to a caller holding none of the approval roles", async () => {
    const body = await callList();
    expect(body.data[0].decision_support.canApproveNow).toBe(false);
    expect(body.data[0].decision_support.canBulkApprove).toBe(false);
  });
});
