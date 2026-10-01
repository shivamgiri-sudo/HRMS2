import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getMyPending: admin is BRANCH-SCOPED like hr (owner ruling 2026-10-01). Only super_admin sees HR / IT
 * task_tat_instance rows of every branch; admin sees its own branch only.
 */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));

const tat = [
  { id: "t-own-hr", module: "exit", branch_id: "b1", owner_user_id: "x", title: "own hr", created_at: "2026-10-01" },
  { id: "t-other-hr", module: "exit", branch_id: "b2", owner_user_id: "x", title: "other hr", created_at: "2026-10-01" },
  { id: "t-other-it", module: "it_access", branch_id: "b2", owner_user_id: "x", title: "other it", created_at: "2026-10-01" },
  { id: "t-own-it", module: "it_access", branch_id: "b1", owner_user_id: "x", title: "own it", created_at: "2026-10-01" },
];

function setup(roles: string[], branch: string | null) {
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM user_roles/.test(sql)) return [roles.map((role_key) => ({ role_key })), []];
    if (/SELECT branch_id FROM employees/.test(sql)) return [branch ? [{ branch_id: branch }] : [], []];
    if (/FROM task_tat_instance/.test(sql)) return [tat, []];
    return [[], []];
  });
}

const ids = async (roles: string[], branch: string | null) => {
  setup(roles, branch);
  const { getMyPending } = await import("../inbox.service.js");
  const out = await getMyPending("u1");
  return out.items.map((i: any) => String(i.id));
};
const has = (list: string[], id: string) => list.some((x) => x.includes(id));

beforeEach(() => { dbExecute.mockReset(); });

describe("getMyPending branch scoping for admin", () => {
  it("admin sees only own-branch HR and IT tasks", async () => {
    const out = await ids(["admin"], "b1");
    expect(has(out, "t-own-hr")).toBe(true);
    expect(has(out, "t-own-it")).toBe(true);
    expect(has(out, "t-other-hr")).toBe(false);
    expect(has(out, "t-other-it")).toBe(false);
  });

  it("admin with no branch sees no branch-bound HR / IT tasks", async () => {
    const out = await ids(["admin"], null);
    expect(out.filter((i) => /t-(own|other)-(hr|it)/.test(i))).toEqual([]);
  });

  it("super_admin still sees every branch", async () => {
    const out = await ids(["super_admin"], "b1");
    for (const id of ["t-own-hr", "t-other-hr", "t-own-it", "t-other-it"]) expect(has(out, id)).toBe(true);
  });
});
