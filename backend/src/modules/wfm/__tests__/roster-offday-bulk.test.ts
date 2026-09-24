import { beforeEach, describe, expect, it, vi } from "vitest";

const { cols, anyPolicy, policies } = vi.hoisted(() => ({
  cols: { set: new Set<string>(["process_id", "lob_id"]) },
  anyPolicy: { v: true },
  policies: { rows: [] as any[] },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../shift-scheduling.util.js", () => ({ rosterAssignmentColumns: async () => cols.set }));
vi.mock("../roster-offday-policy.loader.js", () => ({
  anyActivePolicyExists: async () => anyPolicy.v,
  loadActivePolicies: async () => policies.rows,
  loadProcessEmployeeScopes: async () => new Map(),
}));

import { finalizeBulkRosterRows } from "../roster-offday-bulk.js";

const sqls = (exec: any) => exec.execute.mock.calls.map((c: any[]) => String(c[0]).replace(/\s+/g, " "));
const makeExec = () => ({
  execute: vi.fn(async (sql: string) =>
    /FROM employees WHERE id IN/.test(sql) ? [[{ id: "e1", process_id: "p1", lob_id: "l1", branch_id: "b1" }]] : [{ affectedRows: 1 }]),
});
// 2026-08-23 is a Sunday (weekday 0), 2026-08-24 a Monday.
const FIXED_SUNDAY = { id: 1, process_id: "p1", lob_id: "l1", branch_id: null, off_type: "FIXED_DAY", fixed_weekdays: [0], floating_offs_per_week: null, effective_from: "2026-01-01", effective_to: null };

describe("finalizeBulkRosterRows", () => {
  beforeEach(() => { cols.set = new Set(["process_id", "lob_id"]); anyPolicy.v = false; policies.rows = []; });

  it("does nothing for no cells", async () => {
    const exec = makeExec();
    await finalizeBulkRosterRows([], exec);
    expect(exec.execute).not.toHaveBeenCalled();
  });

  it("stamps process/lob only (NULL-only updates) when no policy exists", async () => {
    const exec = makeExec();
    await finalizeBulkRosterRows([{ employeeId: "e1", rosterDate: "2026-08-23" }], exec);
    const s = sqls(exec);
    expect(s).toHaveLength(2);
    expect(s.every((q: string) => q.startsWith("UPDATE wfm_roster_assignment wra") && q.includes("IS NULL"))).toBe(true);
    expect(s.some((q: string) => q.includes("is_week_off"))).toBe(false);
  });

  it("writes nothing when the process/lob columns are absent and no policy exists", async () => {
    cols.set = new Set();
    const exec = makeExec();
    await finalizeBulkRosterRows([{ employeeId: "e1", rosterDate: "2026-08-23" }], exec);
    expect(exec.execute).not.toHaveBeenCalled();
  });

  it("sets is_week_off and assignment_type together on a FIXED_DAY off date only", async () => {
    anyPolicy.v = true; policies.rows = [FIXED_SUNDAY];
    const exec = makeExec();
    await finalizeBulkRosterRows([
      { employeeId: "e1", rosterDate: "2026-08-23" }, { employeeId: "e1", rosterDate: "2026-08-24" },
    ], exec);
    const marks = exec.execute.mock.calls.filter((c: any[]) => String(c[0]).includes("SET is_week_off = ?, assignment_type = ?"));
    expect(marks).toHaveLength(1);
    expect(marks[0][1]).toEqual([1, "WEEK_OFF", "e1", "2026-08-23"]);
  });

  it("never throws when the database fails", async () => {
    const exec = { execute: vi.fn(async () => { throw new Error("boom"); }) };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(finalizeBulkRosterRows([{ employeeId: "e1", rosterDate: "2026-08-23" }], exec)).resolves.toBeUndefined();
  });
});
