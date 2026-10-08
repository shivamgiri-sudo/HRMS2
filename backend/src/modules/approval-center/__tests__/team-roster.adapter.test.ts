import { describe, it, expect, vi } from "vitest";
import { teamRosterAdapter } from "../adapters/team-roster.js";
import { LoopbackError } from "../types.js";

const listItem = (id: number) => ({ id, submissionNo: `TR-${id}`, status: "x", from: "2030-01-01", to: "2030-01-07", submittedAt: "2030-01-01T05:00:00Z", submitter: { code: "C1", name: "Lead" }, managerApprover: "Boss", lineCount: 2, appliedCount: 0, warningCount: 1 });
const detail = (perm: any) => ({ submission: { note: "Festival cover", managerDecision: null }, lines: [
  { employeeName: "A", employeeCode: "E1", date: "2030-01-02", kind: "CHANGE", old: { label: "GEN 09:00-18:00" }, new: { label: "NIGHT 21:00-06:00" }, reason: "Cover", warnings: [] },
  { employeeName: "B", employeeCode: "E2", date: "2030-01-03", kind: "NEW", old: null, new: { label: "WO" }, reason: null, warnings: [{ message: "Rest < 11h" }] },
], summary: { total: 2, withWarnings: 1 }, permissions: perm });

function ctxFor(opts: { manager: any[]; wfm?: any[] | "403"; perms: Record<string, any> }) {
  const call = vi.fn(async (_m: string, path: string, o?: any) => {
    if (path === "/api/wfm/team-roster/approvals") {
      if (o.query.step === "manager") return { data: { items: opts.manager } };
      if (opts.wfm === "403") throw new LoopbackError(403, "no");
      return { data: { items: opts.wfm ?? [] } };
    }
    const id = path.split("/").pop()!;
    return { data: detail(opts.perms[id]) };
  });
  return { userId: "u", call } as any;
}

describe("teamRosterAdapter", () => {
  it("lists both steps, maps lines, tolerates WFM 403", async () => {
    const ctx = ctxFor({ manager: [listItem(1)], wfm: "403", perms: { 1: { canManagerDecide: true } } });
    const items = await teamRosterAdapter.list(ctx);
    expect(items).toHaveLength(1);
    const i = items[0];
    expect(i.meta).toEqual({ step: "manager" });
    expect(i.stage).toContain("Stage 1");
    expect(i.fields.find((x) => x.label === "Roster changes")?.value).toContain("GEN 09:00-18:00 -> NIGHT 21:00-06:00");
    expect(i.fields.find((x) => x.label === "Roster changes")?.value).toContain("Rest < 11h");
    expect(i.viewPath).toBe("/wfm/team-roster?tab=approvals&submission=1&approvalId=1");
    expect(i.rejectNeedsReason).toBe(true);
  });
  it("drops rows the detail says the caller cannot decide", async () => {
    const ctx = ctxFor({ manager: [listItem(1), listItem(2)], wfm: [listItem(3)], perms: { 1: { canManagerDecide: false }, 2: { canManagerDecide: true }, 3: { canWfmDecide: true } } });
    const items = await teamRosterAdapter.list(ctx);
    expect(items.map((i) => [i.id, i.meta?.step])).toEqual([["2", "manager"], ["3", "wfm"]]);
  });
  it("decides per step", async () => {
    const call = vi.fn().mockResolvedValue({});
    const c = { userId: "u", call } as any;
    await teamRosterAdapter.decide(c, { id: "5", meta: { step: "manager" } }, "approve", "");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/wfm/team-roster/submissions/5/manager-approve", { body: { remarks: null } });
    await teamRosterAdapter.decide(c, { id: "5", meta: { step: "manager" } }, "reject", "bad");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/wfm/team-roster/submissions/5/manager-reject", { body: { remarks: "bad" } });
    await teamRosterAdapter.decide(c, { id: "6", meta: { step: "wfm" } }, "approve", "ok");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/wfm/team-roster/submissions/6/wfm-approve", { body: { remarks: "ok" } });
    await teamRosterAdapter.decide(c, { id: "6", meta: { step: "wfm" } }, "reject", "no");
    expect(call).toHaveBeenLastCalledWith("POST", "/api/wfm/team-roster/submissions/6/wfm-reject", { body: { remarks: "no" } });
  });
});
