import { describe, it, expect } from "vitest";
import { TEAM_MAX_DEPTH, resolveCallerEmployee, resolveTeamTree } from "../team-roster-tree.js";

type Emp = { id: string; rm?: string | null; m?: string | null; active?: boolean };

/** Answers the resolver's UNION query from an in-memory employee table, honouring active_status. */
function fakeExec(employees: Emp[]) {
  const seen: string[] = [];
  return {
    seen,
    execute: async (sql: string, params: string[]) => {
      seen.push(sql);
      expect(sql).toMatch(/active_status = 1/);
      expect(sql).not.toMatch(/\bOR\b/); // never an OR across the two parent columns
      const frontier = new Set(params.slice(0, params.length / 2));
      const ids = employees
        .filter((e) => e.active !== false && ((e.rm && frontier.has(e.rm)) || (e.m && frontier.has(e.m))))
        .map((e) => ({ id: e.id }));
      return [ids, []];
    },
  };
}

describe("resolveTeamTree", () => {
  it("walks the whole multi-level tree, reporting_manager_id and legacy manager_id, manager excluded", async () => {
    const exec = fakeExec([
      { id: "a", rm: "boss" },
      { id: "b", rm: "boss" },
      { id: "c", rm: "a" },
      { id: "d", m: "c" }, // legacy parent column only
      { id: "e", rm: "d" },
      { id: "x", rm: "other" }, // unrelated branch of the org
    ]);
    const tree = await resolveTeamTree("boss", exec);
    expect(tree.ids.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(tree.truncated).toBe(false);
    expect(tree.depth).toBe(4);
  });

  it("terminates on a cycle and never lists anybody twice or the manager", async () => {
    const exec = fakeExec([
      { id: "boss", rm: "b" }, // boss reports to b, b to a, a to boss: a 3-cycle through the manager
      { id: "a", rm: "boss" },
      { id: "b", rm: "a" },
    ]);
    const tree = await resolveTeamTree("boss", exec);
    expect(tree.ids.sort()).toEqual(["a", "b"]);
    expect(tree.ids).not.toContain("boss");
  });

  it("ignores self-referencing rows (an employee is not their own subordinate)", async () => {
    const exec = fakeExec([
      { id: "boss", rm: "boss" },
      { id: "a", rm: "boss" },
      { id: "s", rm: "s" }, // self-edge, unreachable
    ]);
    const tree = await resolveTeamTree("boss", exec);
    expect(tree.ids).toEqual(["a"]);
  });

  it("excludes inactive employees and does not walk through them", async () => {
    const exec = fakeExec([
      { id: "a", rm: "boss" },
      { id: "gone", rm: "boss", active: false },
      { id: "under-gone", rm: "gone" },
      { id: "b", rm: "a" },
    ]);
    const tree = await resolveTeamTree("boss", exec);
    expect(tree.ids.sort()).toEqual(["a", "b"]);
  });

  it("stops at the member cap and reports truncation", async () => {
    const employees: Emp[] = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, rm: "boss" }));
    const tree = await resolveTeamTree("boss", fakeExec(employees), { maxMembers: 10 });
    expect(tree.ids).toHaveLength(10);
    expect(tree.truncated).toBe(true);
  });

  it("stops at the depth cap and reports truncation", async () => {
    const chain: Emp[] = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, rm: i === 0 ? "boss" : `n${i - 1}` }));
    const tree = await resolveTeamTree("boss", fakeExec(chain), { maxDepth: 5 });
    expect(tree.ids).toHaveLength(5);
    expect(tree.truncated).toBe(true);
    expect(TEAM_MAX_DEPTH).toBeGreaterThan(5);
  });

  it("returns an empty, untruncated tree for someone with no reports", async () => {
    const tree = await resolveTeamTree("lonely", fakeExec([{ id: "a", rm: "boss" }]));
    expect(tree).toEqual({ ids: [], truncated: false, depth: 0 });
  });

  it("queries a wide frontier in chunks rather than one giant IN list", async () => {
    const employees: Emp[] = Array.from({ length: 1200 }, (_, i) => ({ id: `e${i}`, rm: "boss" }));
    const exec = fakeExec([...employees, ...employees.map((e) => ({ id: `${e.id}-child`, rm: e.id }))]);
    const tree = await resolveTeamTree("boss", exec);
    expect(tree.ids).toHaveLength(2400);
    // level 2 has a 1200-wide frontier -> 3 chunks of at most 500
    expect(exec.seen.length).toBe(1 + 3 + 3);
  });
});

describe("resolveCallerEmployee", () => {
  it("returns null when the login is not linked to an employee", async () => {
    expect(await resolveCallerEmployee("u1", { execute: async () => [[], []] })).toBeNull();
  });

  it("falls back to the legacy manager_id when reporting_manager_id is empty", async () => {
    const caller = await resolveCallerEmployee("u1", {
      execute: async () => [[{ id: "e1", employee_code: "MAS1", full_name: "Asha K", branch_id: "b1", process_id: "p1", reporting_manager_id: null, manager_id: "m9", active_status: 1 }], []],
    });
    expect(caller).toMatchObject({ id: "e1", name: "Asha K", reportingManagerId: "m9", active: true });
  });
});
