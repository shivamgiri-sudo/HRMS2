import { describe, it, expect, vi } from "vitest";
import { activateRejoin, RejoinBlockedError } from "../rejoinActivation.js";

interface Call { sql: string; params: unknown[] }

function conn(opts: { facts: Record<string, unknown>; stintCount?: number }) {
  const calls: Call[] = [];
  return {
    calls,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("LEFT JOIN employee_rehire_control")) return [[{ employment_status: "Resigned", date_of_exit: "2026-09-01", disciplinary_flag: opts.facts.disciplinary ? 1 : 0, rehire_block_lifted_at: null }], []];
      if (sql.includes("FROM exit_request") && sql.includes("ORDER BY created_at")) return [[{ id: "x1", exit_type: "voluntary", exit_sub_type: opts.facts.sub ?? "resignation", exit_reason_category: "relocation", lwd: "2026-09-10" }], []];
      if (sql.includes("MAX(stint_no)")) return [[{ n: opts.stintCount ?? 0 }], []];
      if (sql.includes("COUNT(*)")) return [[{ n: 0 }], []];
      if (sql.includes("ff_paid_at")) return [[], []];
      return [{ affectedRows: 1 }, []];
    }),
  };
}

const request = { id: "r1", employee_id: "e1", proposed_joining_date: "2026-09-20", absconding_acknowledged: 0 };

describe("activateRejoin", () => {
  it("closes the old exit as rejoined, inserts the stint, reactivates, and audits — in that order", async () => {
    const c = conn({ facts: {} });
    await activateRejoin(c as never, request as never, "approver-1", "good performer");
    const sqls = c.calls.map((x) => x.sql.replace(/\s+/g, " "));
    const idx = (frag: string) => sqls.findIndex((s) => s.includes(frag));
    expect(idx("UPDATE exit_request SET status = 'rejoined'")).toBeGreaterThan(-1);
    expect(idx("INSERT INTO employment_stint")).toBeGreaterThan(idx("UPDATE exit_request SET status = 'rejoined'"));
    expect(idx("UPDATE employees")).toBeGreaterThan(idx("INSERT INTO employment_stint"));
    expect(idx("INSERT INTO employee_reactivation_audit")).toBeGreaterThan(idx("UPDATE employees"));
  });

  it("never overwrites date_of_joining", async () => {
    const c = conn({ facts: {} });
    await activateRejoin(c as never, request as never, "approver-1", "ok");
    const upd = c.calls.find((x) => x.sql.includes("UPDATE employees"))!;
    expect(upd.sql).not.toMatch(/date_of_joining/);
    expect(upd.sql).toMatch(/date_of_exit\s*=\s*NULL/);
    expect(upd.sql).toMatch(/employment_status\s*=\s*'Active'/);
  });

  it("creates stint 1 for the original stint and stint 2 for the rejoin when no stint rows exist", async () => {
    const c = conn({ facts: {}, stintCount: 0 });
    await activateRejoin(c as never, request as never, "approver-1", "ok");
    const inserts = c.calls.filter((x) => x.sql.includes("INSERT INTO employment_stint"));
    expect(inserts).toHaveLength(2);
    expect(inserts[1]!.params).toContain(2);
  });

  it("re-checks eligibility and refuses a blocked employee before any write", async () => {
    const c = conn({ facts: { sub: "termination" } });
    await expect(activateRejoin(c as never, request as never, "approver-1", "ok")).rejects.toBeInstanceOf(RejoinBlockedError);
    expect(c.calls.some((x) => /^\s*(UPDATE|INSERT)/i.test(x.sql))).toBe(false);
  });

  it("refuses an absconding rejoin the branch head did not acknowledge", async () => {
    const c = conn({ facts: { sub: "absconding" } });
    await expect(activateRejoin(c as never, { ...request, absconding_acknowledged: 0 } as never, "approver-1", "ok")).rejects.toBeInstanceOf(RejoinBlockedError);
  });
});
