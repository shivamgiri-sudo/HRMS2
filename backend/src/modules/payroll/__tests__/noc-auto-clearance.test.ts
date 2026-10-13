/**
 * NOC auto-clearance profile, pinned.
 *
 *   1. DEFAULT OFF — an unset or unreadable flag means today's behaviour exactly.
 *   2. PARALLEL STAGES — with the profile on, the reporting chain and the evidence-based stages
 *      open together and the case does not wait for the employee form.
 *   3. HR CLOSES LAST AND NEVER EARLY — HR waits for the MANDATORY stages only (Accounts and
 *      Finance are tracked, not blocking), and cannot close before the Last Working Day.
 *   4. OFF IS UNCHANGED — the same inputs without the profile still hit the form gate and the
 *      stored tiers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));

const { stageBlockReason, evaluateAssetGate } = await import("../noc-case.service.js");
const { isNocAutoClearanceEnabled, autoTierOf, isChainStage } = await import("../noc-auto-profile.js");

type Sig = Parameters<typeof stageBlockReason>[1][number];
type NocCase = Parameters<typeof stageBlockReason>[0];

const SPEC: Array<[string, number, number, string, number, number]> = [
  // key, display, stored tier, label, requires_asset, is_mandatory
  ["team_leader", 1, 1, "Team Leader", 0, 1],
  ["process_manager", 2, 2, "Process Manager", 0, 1],
  ["branch_manager", 4, 3, "Branch Manager", 0, 1],
  ["hr", 3, 4, "HR", 0, 1],
  ["it", 5, 5, "IT", 0, 1],
  ["admin", 6, 5, "Admin", 0, 1],
  ["accounts", 7, 5, "Accounts", 0, 0],
  ["finance", 8, 5, "Finance", 1, 0],
];

function sigs(overrides: Record<string, Sig["status"]> = {}): Sig[] {
  return SPEC.map(([stage_key, display_no, tier, stage_label, ra, mand]) => ({
    id: `sig-${stage_key}`,
    noc_case_id: "case-1",
    display_no,
    tier,
    stage_key,
    stage_label,
    role_key: stage_key,
    fallback_role_key: null,
    requires_asset_clearance: ra,
    is_mandatory: mand,
    status: overrides[stage_key] ?? "pending",
    acted_by_user_id: null,
    acted_by_name: null,
    acted_by_role: null,
    acted_at: null,
    remarks: null,
    sla_due_at: null,
    notified_at: null,
    reminder_count: 0,
  })) as Sig[];
}

function nocCase(over: Partial<NocCase> = {}): NocCase {
  return {
    id: "case-1",
    status: "invited",
    last_working_day: "2000-01-01",
    declined_stage_key: null,
    ...over,
  } as NocCase;
}

const gate = evaluateAssetGate([]);
const block = (all: Sig[], key: string, auto: boolean, c = nocCase()) =>
  stageBlockReason(c, all, all.find((s) => s.stage_key === key)!, gate, auto);

describe("auto-clearance flag", () => {
  beforeEach(() => execute.mockReset());

  it("is OFF when the row is absent", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await isNocAutoClearanceEnabled()).toBe(false);
  });

  it("is OFF when the read fails", async () => {
    execute.mockRejectedValueOnce(new Error("db down"));
    expect(await isNocAutoClearanceEnabled()).toBe(false);
  });

  it("is ON only for an explicit 'true'", async () => {
    execute.mockResolvedValueOnce([[{ config_value: "true" }]]);
    expect(await isNocAutoClearanceEnabled()).toBe(true);
    execute.mockResolvedValueOnce([[{ config_value: "1" }]]);
    expect(await isNocAutoClearanceEnabled()).toBe(false);
  });
});

describe("profile geometry", () => {
  it("maps every seeded stage to tier 1 except HR", () => {
    for (const [key, , stored] of SPEC) {
      expect(autoTierOf(key, stored)).toBe(key === "hr" ? 2 : 1);
    }
  });

  it("keeps the stored tier for a stage it does not know", () => {
    expect(autoTierOf("legal", 6)).toBe(6);
  });

  it("recognises exactly the three reporting-chain stages", () => {
    expect(["team_leader", "process_manager", "branch_manager"].every(isChainStage)).toBe(true);
    expect(isChainStage("hr")).toBe(false);
    expect(isChainStage("it")).toBe(false);
  });
});

describe("stageBlockReason under the profile", () => {
  it("opens the chain and the evidence stages together, without the employee form", () => {
    const all = sigs();
    for (const key of ["team_leader", "process_manager", "branch_manager", "it", "admin", "accounts"]) {
      expect(block(all, key, true)).toBeNull();
    }
  });

  it("still applies the form gate when the profile is off", () => {
    expect(block(sigs(), "team_leader", false)?.code).toBe("EMPLOYEE_FORM_PENDING");
  });

  it("keeps stored tiers when off (PM waits for TL)", () => {
    const c = nocCase({ status: "employee_submitted" });
    expect(block(sigs(), "process_manager", false, c)?.code).toBe("PRIOR_TIER_PENDING");
  });

  it("holds HR until every mandatory stage has responded", () => {
    const partial = sigs({ team_leader: "accepted", process_manager: "accepted", branch_manager: "accepted", it: "acknowledged" });
    expect(block(partial, "hr", true)?.code).toBe("PRIOR_TIER_PENDING");
  });

  it("does not let non-mandatory Accounts/Finance hold HR open", () => {
    const done = sigs({
      team_leader: "accepted",
      process_manager: "acknowledged",
      branch_manager: "acknowledged",
      it: "acknowledged",
      admin: "acknowledged",
      // accounts + finance deliberately left pending
    });
    expect(block(done, "hr", true)).toBeNull();
  });

  it("refuses HR before the Last Working Day", () => {
    const done = sigs({
      team_leader: "accepted",
      process_manager: "acknowledged",
      branch_manager: "acknowledged",
      it: "acknowledged",
      admin: "acknowledged",
    });
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(block(done, "hr", true, nocCase({ last_working_day: future }))?.code).toBe("LWD_NOT_REACHED");
  });

  it("still requires a Last Working Day for HR", () => {
    const done = sigs({
      team_leader: "accepted",
      process_manager: "acknowledged",
      branch_manager: "acknowledged",
      it: "acknowledged",
      admin: "acknowledged",
    });
    expect(block(done, "hr", true, nocCase({ last_working_day: null }))?.code).toBe("LWD_NOT_SET");
  });

  it("a declined case still locks every stage under the profile", () => {
    const c = nocCase({ status: "declined", declined_stage_key: "it" });
    expect(block(sigs(), "team_leader", true, c)?.code).toBe("CASE_NOT_OPEN");
  });
});
