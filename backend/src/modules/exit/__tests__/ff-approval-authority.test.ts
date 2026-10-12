import { beforeEach, describe, expect, it, vi } from "vitest";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
const { isFfApprovalPayrollHeadOnly } = await import("../ff-approval-authority.js");

describe("F&F approval authority flag", () => {
  beforeEach(() => execute.mockReset());
  it("defaults to Payroll Head only when unset", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await isFfApprovalPayrollHeadOnly()).toBe(true);
  });
  it("is relaxed only by an explicit 'false'", async () => {
    execute.mockResolvedValueOnce([[{ config_value: "false" }]]);
    expect(await isFfApprovalPayrollHeadOnly()).toBe(false);
  });
  it("stays strict when the flag cannot be read", async () => {
    execute.mockRejectedValueOnce(new Error("db down"));
    expect(await isFfApprovalPayrollHeadOnly()).toBe(true);
  });
});
