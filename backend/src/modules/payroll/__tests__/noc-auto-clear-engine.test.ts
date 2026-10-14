/**
 * The engine's one governing rule: absence of evidence is never clearance.
 * A stage is recorded only on a positive, system-held fact, and the fact rides on the decision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, actOnSignatory, state } = vi.hoisted(() => ({
  execute: vi.fn(),
  actOnSignatory: vi.fn(),
  state: { sigs: [] as Array<Record<string, unknown>> },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));
vi.mock("../noc-auto-profile.js", async (orig) => ({
  ...(await orig<typeof import("../noc-auto-profile.js")>()),
  isNocAutoClearanceEnabled: async () => true,
}));

const caseRow = { id: "c1", employee_id: "e1", exit_request_id: "x1", status: "invited", last_working_day: "2000-01-01" };
const mkSig = (stage_key: string, tier: number, is_mandatory = 1) => ({
  id: `s-${stage_key}`, noc_case_id: "c1", display_no: 1, tier, stage_key, stage_label: stage_key,
  role_key: stage_key, fallback_role_key: null, requires_asset_clearance: 0, is_mandatory,
  status: "pending", sla_due_at: null, reminder_count: 0,
});

vi.mock("../noc-case.service.js", async (orig) => {
  const real = await orig<typeof import("../noc-case.service.js")>();
  return {
    ...real,
    getCase: async () => caseRow,
    getSignatories: async () => state.sigs,
    getAssets: async () => [],
    actionableStages: async () => [],
    startSlaForCase: async () => undefined,
    setLastWorkingDay: async () => undefined,
    actOnSignatory,
  };
});

const { runAutoClearForCase } = await import("../noc-auto-clear.service.js");

function route(provisioning: Array<{ task_code: string; status: string }>, openAssets: number) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("it_provisioning_request")) return [provisioning];
    if (sql.includes("asset_assignment")) return [[{ n: openAssets }]];
    return [[]];
  });
}
const ALL_DONE = ["domain_delete", "email_delete", "dialler_delete"].map((task_code) => ({ task_code, status: "confirmed" }));

describe("IT stage evidence", () => {
  beforeEach(() => {
    execute.mockReset();
    actOnSignatory.mockReset();
    state.sigs = [mkSig("it", 1)];
    // Mirror the real service: a recorded decision changes the stage's persisted status.
    actOnSignatory.mockImplementation(async (p: { stageKey: string; decision: string }) => {
      state.sigs = state.sigs.map((x) => (x.stage_key === p.stageKey ? { ...x, status: p.decision } : x));
      return { completed: false, declined: false, newlyActionable: [], caseStatus: "in_progress" };
    });
  });

  it("clears IT when no asset is assigned, even with no provisioning task", async () => {
    route([], 0);
    const r = await runAutoClearForCase("c1");
    expect(r.cleared).toEqual(["it"]);
    expect(actOnSignatory.mock.calls[0][0].remarks).toMatch(/no asset assigned/);
  });

  it("does NOT clear IT while an asset is assigned, whatever the access tasks say", async () => {
    route([], 1);
    expect((await runAutoClearForCase("c1")).cleared).toEqual([]);
  });

  it("does NOT clear while an asset is still assigned in the register", async () => {
    route(ALL_DONE, 1);
    expect((await runAutoClearForCase("c1")).cleared).toEqual([]);
  });

  it("does NOT clear when the evidence query fails", async () => {
    execute.mockRejectedValue(new Error("db down"));
    expect((await runAutoClearForCase("c1")).cleared).toEqual([]);
    expect(actOnSignatory).not.toHaveBeenCalled();
  });

  it("clears on positive evidence, as the system actor, with the evidence on the decision", async () => {
    route(ALL_DONE, 0);
    const r = await runAutoClearForCase("c1");
    expect(r.cleared).toEqual(["it"]);
    const arg = actOnSignatory.mock.calls[0][0];
    expect(arg.decision).toBe("acknowledged");
    expect(arg.actorUserId).toBe("system:noc-auto-clear");
    expect(arg.actorRole).toBe("system");
    expect(arg.remarks).toMatch(/no asset assigned/);
  });
});
