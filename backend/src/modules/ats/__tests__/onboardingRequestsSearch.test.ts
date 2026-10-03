import { describe, it, expect, vi, beforeEach } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute: query } }));

import { listOnboardingRequests } from "../ats.onboarding.service.js";

beforeEach(() => { query.mockReset(); query.mockResolvedValue([[]]); });
const scope = { sql: "r.branch_id = ?", params: ["b1"] };

describe("listOnboardingRequests search", () => {
  it("no search: scope only, newest-500 window unchanged", async () => {
    await listOnboardingRequests(scope);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("e.employee_code LIKE");
    expect(sql).toContain("LIMIT 500");
    expect(params).toEqual(["b1"]);
  });

  it("2 chars is ignored (too broad)", async () => {
    await listOnboardingRequests(scope, "ab");
    expect(query.mock.calls[0][1]).toEqual(["b1"]);
  });

  it("3+ chars adds a parameterised match on name, candidate code, employee code, mobile, email — after the scope params", async () => {
    await listOnboardingRequests(scope, "  MAS1234 ");
    const [sql, params] = query.mock.calls[0];
    for (const col of ["c.full_name", "c.candidate_code", "e.employee_code", "c.mobile", "c.email"]) expect(sql).toContain(`${col} LIKE ?`);
    expect(params).toEqual(["b1", ...Array(5).fill("%MAS1234%")]);
    expect(sql).not.toContain("MAS1234"); // never interpolated
  });

  it("strips LIKE wildcards so a user cannot widen the match, and the scope clause stays ANDed", async () => {
    await listOnboardingRequests(scope, "a%_b%c");
    const [sql, params] = query.mock.calls[0];
    expect(params[1]).toBe("%abc%");
    expect(sql).toMatch(/WHERE \(r\.branch_id = \?\) AND \(/);
  });
});
