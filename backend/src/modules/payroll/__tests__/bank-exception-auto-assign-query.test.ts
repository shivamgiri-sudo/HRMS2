/**
 * resolvePayrollHrForBranch must reach employees through the (small) set of payroll_hr grant
 * holders instead of scanning all employees and LEFT JOINing role tables onto each. Same result
 * set: the original WHERE (ur.id IS NOT NULL OR uas.id IS NOT NULL) is kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, execute } = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute } }));
vi.mock("../../communication/notification.gateway.js", () => ({
  notificationGateway: { notify: vi.fn() },
}));

import { autoAssignBankExceptionsToPayrollHr } from "../bank-exception-auto-assign.service.js";

beforeEach(() => {
  query.mockReset();
  execute.mockReset();
});

describe("resolvePayrollHrForBranch query shape", () => {
  it("drives from a user_id derived table of role holders, keeping the original filters", async () => {
    query.mockResolvedValue([[], []]);
    const out = await autoAssignBankExceptionsToPayrollHr([
      {
        readiness_class: "MISSING",
        branch_id: "br-x",
        employee_id: "e1",
      } as any,
    ]);
    expect(out.skipped_no_branch_hr).toBe(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(
      /FROM \(\s*SELECT r\.user_id FROM user_roles r[\s\S]*UNION[\s\S]*SELECT s\.user_id FROM user_assignment_scope s[\s\S]*\) g\s+JOIN employees e ON e\.user_id = g\.user_id/,
    );
    expect(sql).toMatch(/\(ur\.id IS NOT NULL OR uas\.id IS NOT NULL\)/);
    expect(sql).toMatch(/ORDER BY e\.employee_code\s+LIMIT 1/);
    expect(query.mock.calls[0][1]).toEqual(["br-x", "br-x"]);
  });
});
