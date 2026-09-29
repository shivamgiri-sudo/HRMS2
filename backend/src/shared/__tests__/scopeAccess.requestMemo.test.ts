import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));

import { getUserRoleKeys, hasAnyRole } from "../scopeAccess.js";
import { runWithRequestContext } from "../requestContext.js";

describe("scopeAccess role lookup is memoised per request", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[{ role_key: "hr" }], []]);
  });

  it("runs one user_roles query for repeated checks in a request", async () => {
    await runWithRequestContext(async () => {
      await hasAnyRole("u1", "super_admin");
      await hasAnyRole("u1", "admin");
      await hasAnyRole("u1", "hr");
      expect(await getUserRoleKeys("u1")).toEqual(["hr"]);
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("returns a copy so callers cannot poison the memo", async () => {
    await runWithRequestContext(async () => {
      (await getUserRoleKeys("u1")).push("super_admin");
      expect(await hasAnyRole("u1", "super_admin")).toBe(false);
    });
  });

  it("does not share across requests or users, and never caches outside a request", async () => {
    await runWithRequestContext(() => getUserRoleKeys("u1"));
    await runWithRequestContext(() => getUserRoleKeys("u1"));
    expect(mockExecute).toHaveBeenCalledTimes(2);
    await getUserRoleKeys("u1");
    await getUserRoleKeys("u1");
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });
});
