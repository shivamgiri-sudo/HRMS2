import { beforeEach, describe, expect, it, vi } from "vitest";

/** Gate-pass verification: security staff verify their own branch's passes only. */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, getConnection: vi.fn() } }));
const svc = await import("../exit-pass.service.js");

const actor = (branchId: string | null) => ({ employeeId: "e1", branchId, fullName: "G" });
beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM exit_pass_items/.test(sql)) return [[], []];
    return [[{ id: "p1", pass_number: "GP-1", status: "approved", branch_id: "b-pass", movement_type: "non_returnable" }], []];
  });
});

describe("findPassForVerification branch check", () => {
  it("security of another branch is refused", async () => {
    await expect(svc.findPassForVerification("GP-1", { actor: actor("b-other"), roles: ["visitor_security"] }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it("security with no branch fails closed", async () => {
    await expect(svc.findPassForVerification("GP-1", { actor: actor(null), roles: ["security_head"] })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("same-branch security and admin pass", async () => {
    expect((await svc.findPassForVerification("GP-1", { actor: actor("b-pass"), roles: ["visitor_security"] })).verdict).toBe("valid");
    expect((await svc.findPassForVerification("GP-1", { actor: actor("b-other"), roles: ["admin"] })).verdict).toBe("valid");
  });
  it("verifyExit refuses a foreign branch pass before touching status", async () => {
    await expect(svc.verifyExit("GP-1", actor("b-other"), ["visitor_security"], { gate: "G1", method: "manual" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(dbExecute.mock.calls.some(([sql]) => /UPDATE exit_pass_requests/.test(sql))).toBe(false);
  });
});
