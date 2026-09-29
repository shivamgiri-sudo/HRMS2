import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));

import { getUserRoleKeys } from "../roleResolver.js";

describe("roleResolver.getUserRoleKeys concurrent lookups", () => {
  beforeEach(() => mockExecute.mockReset());

  it("issues both role queries before either resolves", async () => {
    const started: string[] = [];
    mockExecute.mockImplementation((sqlArg: unknown) => {
      const sql = String(sqlArg ?? "");
      started.push(sql.includes("user_assignment_scope") ? "scope" : "roles");
      return new Promise((r) => setTimeout(() => r([[{ role_key: started.length === 1 ? "hr" : "wfm" }], []]), 5));
    });
    const roles = await getUserRoleKeys("u1");
    expect(started.slice(0, 2).sort()).toEqual(["roles", "scope"]);
    expect(roles.length).toBeGreaterThan(0);
  });

  it("merges user_roles then scope roles, and survives a scope-table failure", async () => {
    mockExecute.mockImplementation((sqlArg: unknown) =>
      String(sqlArg ?? "").includes("user_assignment_scope")
        ? Promise.reject(new Error("no table"))
        : Promise.resolve([[{ role_key: "hr" }], []]));
    expect(await getUserRoleKeys("u1")).toEqual(["hr"]);
  });

  it("falls back to employee when both lookups fail", async () => {
    mockExecute.mockImplementation((sqlArg: unknown) =>
      {
      const q = String(sqlArg ?? "");
      if (q.includes("FROM employees")) return Promise.resolve([[{ id: "e1" }], []]);
      if (q.includes("user_roles") || q.includes("user_assignment_scope")) return Promise.reject(new Error("x"));
      return Promise.resolve([[], []]);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getUserRoleKeys("u1")).toEqual(["employee"]);
  });
});
