/**
 * The four NOC rules that carry money, pinned.
 *
 *   1. TIER GATING — stages 1-4 run in parallel per tier, and a tier only opens once every LOWER
 *      tier has responded positively. The certificate's printed order (display_no) is NOT the
 *      approval order (tier): the form numbers HR third while the hierarchy clears HR fourth. A
 *      regression that collapses the two would let HR sign before the Branch Manager.
 *
 *   2. FINANCE ASSET GATE — 'na' must NOT satisfy it. The column defaults to 'na', so if 'na'
 *      counted as cleared then every case would pass the gate the moment it was created and the
 *      control would be decorative.
 *
 *   3. DECLINE IS A LOCK — a declined case blocks every remaining stage. The workflow must not
 *      continue past a refusal.
 *
 *   4. RELEASE GATE — an inactive employee with no completed NOC is withheld; an override
 *      releases them; an ACTIVE employee is never touched by any of it.
 *
 * stageBlockReason and evaluateAssetGate are pure, so 1-3 are tested directly rather than through
 * the database. That is the point of them being pure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));

const { stageBlockReason, evaluateAssetGate } = await import("../noc-case.service.js");
const { nocReleaseStatusForEmployee, nocReleaseClearedSql } = await import("../noc-release-gate.service.js");

type Sig = Parameters<typeof stageBlockReason>[1][number];
type NocCase = Parameters<typeof stageBlockReason>[0];

/** The seeded chain: TL(1) -> PM(2) -> Branch Manager(3) -> HR(4) -> IT/Admin/Accounts/Finance(5). */
function chain(overrides: Partial<Record<string, Sig["status"]>> = {}): Sig[] {
  const spec: Array<[string, number, number, string, number]> = [
    ["team_leader", 1, 1, "Team Leader", 0],
    ["process_manager", 2, 2, "Process Manager", 0],
    ["branch_manager", 4, 3, "Branch Manager", 0],
    ["hr", 3, 4, "HR", 0],
    ["it", 5, 5, "IT", 0],
    ["admin", 6, 5, "Admin", 0],
    ["accounts", 7, 5, "Accounts", 0],
    ["finance", 8, 5, "Finance", 1],
  ];
  return spec.map(([stage_key, display_no, tier, stage_label, requires_asset_clearance]) => ({
    id: `sig-${stage_key}`,
    noc_case_id: "case-1",
    display_no,
    tier,
    stage_key,
    stage_label,
    role_key: stage_key,
    fallback_role_key: null,
    requires_asset_clearance,
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

function nocCase(overrides: Partial<NocCase> = {}): NocCase {
  return {
    id: "case-1",
    employee_id: "emp-1",
    exit_request_id: null,
    branch_id: "branch-1",
    process_id: null,
    employee_code: "MAS001",
    employee_name: "Test Leaver",
    location: null,
    portfolio: null,
    designation: null,
    initiator_role: "tl",
    initiated_by_user_id: null,
    initiated_at: null,
    resignation_date: "2026-08-01",
    reason_for_leaving: null,
    employee_submitted_at: "2026-08-02 10:00:00",
    last_working_day: "2026-08-31",
    fnf_option_suggested: null,
    fnf_option: null,
    status: "in_progress",
    declined_stage_key: null,
    declined_by: null,
    declined_at: null,
    decline_reason: null,
    completed_at: null,
    override_by: null,
    override_at: null,
    override_reason: null,
    created_at: "2026-08-01 09:00:00",
    ...overrides,
  } as NocCase;
}

const CLEAR_GATE = { satisfied: true, outstanding: [] as string[] };

function find(all: Sig[], key: string): Sig {
  const s = all.find((x) => x.stage_key === key);
  if (!s) throw new Error(`no stage ${key}`);
  return s;
}

beforeEach(() => { execute.mockReset(); });

// ─────────────────────────────────────────────────────────────────────────────

describe("tier gating", () => {
  it("opens Team Leader first and blocks every higher tier", () => {
    const all = chain();
    const c = nocCase();

    expect(stageBlockReason(c, all, find(all, "team_leader"), CLEAR_GATE)).toBeNull();

    for (const key of ["process_manager", "branch_manager", "hr", "it", "finance"]) {
      expect(stageBlockReason(c, all, find(all, key), CLEAR_GATE)?.code)
        .toBe("PRIOR_TIER_PENDING");
    }
  });

  it("treats acknowledged as clearing a tier, exactly like accepted", () => {
    // The paper form offers both and the distinction is the signatory's own; it is not a
    // difference in workflow effect. If only 'accepted' advanced the chain, an acknowledged
    // stage would deadlock the case forever.
    const all = chain({ team_leader: "acknowledged" });
    expect(stageBlockReason(nocCase(), all, find(all, "process_manager"), CLEAR_GATE)).toBeNull();
  });

  it("clears HR only after the Branch Manager, despite HR printing as #3 and BM as #4", () => {
    // The regression this exists to catch: ordering the chain by the certificate's display_no
    // instead of by tier would let HR sign before the Branch Manager.
    const upToBm = chain({ team_leader: "accepted", process_manager: "accepted" });
    expect(stageBlockReason(nocCase(), upToBm, find(upToBm, "hr"), CLEAR_GATE)?.code)
      .toBe("PRIOR_TIER_PENDING");
    expect(stageBlockReason(nocCase(), upToBm, find(upToBm, "branch_manager"), CLEAR_GATE)).toBeNull();

    const hrTurn = chain({ team_leader: "accepted", process_manager: "accepted", branch_manager: "accepted" });
    expect(stageBlockReason(nocCase(), hrTurn, find(hrTurn, "hr"), CLEAR_GATE)).toBeNull();
  });

  it("opens IT, Admin, Accounts and Finance together once HR clears", () => {
    const all = chain({
      team_leader: "accepted", process_manager: "accepted",
      branch_manager: "accepted", hr: "accepted",
    });
    const c = nocCase();
    for (const key of ["it", "admin", "accounts"]) {
      expect(stageBlockReason(c, all, find(all, key), CLEAR_GATE)).toBeNull();
    }
    // Finance too, but only because the asset gate is satisfied in this fixture.
    expect(stageBlockReason(c, all, find(all, "finance"), CLEAR_GATE)).toBeNull();
  });

  it("does not let one tier-5 department block another", () => {
    const all = chain({
      team_leader: "accepted", process_manager: "accepted",
      branch_manager: "accepted", hr: "accepted", it: "accepted",
    });
    expect(stageBlockReason(nocCase(), all, find(all, "accounts"), CLEAR_GATE)).toBeNull();
  });

  it("blocks HR's own stage until the Last Working Day is recorded", () => {
    // HR owns the LWD, and the FNF route, the 45-day window and final pay all derive from it.
    const all = chain({ team_leader: "accepted", process_manager: "accepted", branch_manager: "accepted" });
    const c = nocCase({ last_working_day: null });
    expect(stageBlockReason(c, all, find(all, "hr"), CLEAR_GATE)?.code).toBe("LWD_NOT_SET");
  });

  it("blocks every stage until the employee has submitted the form", () => {
    const all = chain();
    const c = nocCase({ status: "invited", employee_submitted_at: null });
    expect(stageBlockReason(c, all, find(all, "team_leader"), CLEAR_GATE)?.code)
      .toBe("EMPLOYEE_FORM_PENDING");
  });
});

describe("Finance asset gate", () => {
  const asset = (over: Partial<{ item_label: string; is_mandatory_for_finance: number; status: string; waived_at: string | null }> = {}) => ({
    id: "a", item_no: 1, item_code: "ID_CARD", item_label: "ID Card",
    is_mandatory_for_finance: 1, shown_on_form: 1, quantity: 1,
    status: "na", remarks: null, waived_by: null, waived_at: null, waiver_reason: null,
    ...over,
  }) as Parameters<typeof evaluateAssetGate>[0][number];

  it("does NOT accept 'na' as cleared", () => {
    // 'na' is the column default. If it satisfied the gate, every case would pass it at creation
    // and the control would never fire.
    const gate = evaluateAssetGate([asset({ status: "na" })]);
    expect(gate.satisfied).toBe(false);
    expect(gate.outstanding).toEqual(["ID Card"]);
  });

  it("does not accept 'not_returned'", () => {
    expect(evaluateAssetGate([asset({ status: "not_returned" })]).satisfied).toBe(false);
  });

  it("accepts 'returned'", () => {
    expect(evaluateAssetGate([asset({ status: "returned" })]).satisfied).toBe(true);
  });

  it("accepts an explicit waiver on an unreturned item", () => {
    const gate = evaluateAssetGate([asset({ status: "not_returned", waived_at: "2026-08-10 12:00:00" })]);
    expect(gate.satisfied).toBe(true);
  });

  it("ignores non-mandatory items entirely", () => {
    const gate = evaluateAssetGate([
      asset({ item_label: "SIM Card", is_mandatory_for_finance: 0, status: "not_returned" }),
    ]);
    expect(gate.satisfied).toBe(true);
  });

  it("blocks Finance, and only Finance, when property is outstanding", () => {
    const all = chain({
      team_leader: "accepted", process_manager: "accepted",
      branch_manager: "accepted", hr: "accepted",
    });
    const c = nocCase();
    const outstanding = { satisfied: false, outstanding: ["ID Card", "CPU"] };

    expect(stageBlockReason(c, all, find(all, "finance"), outstanding)?.code).toBe("ASSETS_OUTSTANDING");
    // Admin and IT are the ones who resolve it, so they must stay actionable.
    expect(stageBlockReason(c, all, find(all, "admin"), outstanding)).toBeNull();
    expect(stageBlockReason(c, all, find(all, "it"), outstanding)).toBeNull();
    expect(stageBlockReason(c, all, find(all, "accounts"), outstanding)).toBeNull();
  });
});

describe("decline locks the case", () => {
  it("blocks every remaining stage once any signatory declines", () => {
    const all = chain({ team_leader: "accepted", process_manager: "declined" });
    const c = nocCase({ status: "declined", declined_stage_key: "process_manager" });

    for (const key of ["branch_manager", "hr", "it", "admin", "accounts", "finance"]) {
      expect(stageBlockReason(c, all, find(all, key), CLEAR_GATE)?.code).toBe("CASE_NOT_OPEN");
    }
  });

  it("reports an already-actioned stage as such rather than as a case-level block", () => {
    const all = chain({ team_leader: "accepted" });
    expect(stageBlockReason(nocCase(), all, find(all, "team_leader"), CLEAR_GATE)?.code)
      .toBe("ALREADY_ACTIONED");
  });
});

describe("salary release gate", () => {
  /** payroll_config_flags read — the kill switch. */
  function mockGateEnabled() { execute.mockResolvedValueOnce([[{ config_value: "true" }]]); }

  it("never withholds an ACTIVE employee, and does not look for a case", async () => {
    mockGateEnabled();
    execute.mockResolvedValueOnce([[{ employment_status: "active" }]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(false);
    // Two calls only: the flag and the employee. No noc_case lookup for an active employee.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("withholds an inactive employee with no NOC raised at all", async () => {
    mockGateEnabled();
    execute.mockResolvedValueOnce([[{ employment_status: "Exited" }]]);
    execute.mockResolvedValueOnce([[]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(true);
    expect(status.hasCase).toBe(false);
    expect(status.reason).toMatch(/No NOC clearance has been raised/i);
  });

  it("withholds an inactive employee whose clearance is still in progress", async () => {
    mockGateEnabled();
    execute.mockResolvedValueOnce([[{ employment_status: "Resigned" }]]);
    execute.mockResolvedValueOnce([[{ status: "in_progress", override_at: null, declined_stage_key: null }]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(true);
    expect(status.caseStatus).toBe("in_progress");
  });

  it("releases an inactive employee once the clearance is completed", async () => {
    mockGateEnabled();
    execute.mockResolvedValueOnce([[{ employment_status: "Exited" }]]);
    execute.mockResolvedValueOnce([[{ status: "completed", override_at: null, declined_stage_key: null }]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(false);
    expect(status.overridden).toBe(false);
  });

  it("releases on a Payroll Head override, and reports it AS an override", async () => {
    // The override must never read as a clearance: status stays what it was, and `overridden` is
    // what tells the caller which of the two released the money.
    mockGateEnabled();
    execute.mockResolvedValueOnce([[{ employment_status: "Exited" }]]);
    execute.mockResolvedValueOnce([[{ status: "in_progress", override_at: "2026-08-20 11:00:00", declined_stage_key: null }]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(false);
    expect(status.overridden).toBe(true);
    expect(status.caseStatus).toBe("in_progress");
  });

  it("withholds a declined clearance and names the declining stage", async () => {
    mockGateEnabled();
    execute.mockResolvedValueOnce([[{ employment_status: "Exited" }]]);
    execute.mockResolvedValueOnce([[{ status: "declined", override_at: null, declined_stage_key: "finance" }]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(true);
    expect(status.reason).toContain("finance");
  });

  it("withholds nobody when the kill switch is explicitly off", async () => {
    execute.mockResolvedValueOnce([[{ config_value: "false" }]]);

    const status = await nocReleaseStatusForEmployee("emp-1");

    expect(status.blocked).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applies the gate when the flag row is MISSING (fails closed)", async () => {
    // A pre-migration state must not weaken the control.
    execute.mockResolvedValueOnce([[]]);
    execute.mockResolvedValueOnce([[{ employment_status: "Exited" }]]);
    execute.mockResolvedValueOnce([[]]);

    expect((await nocReleaseStatusForEmployee("emp-1")).blocked).toBe(true);
  });

  it("does NOT apply the gate when the flag cannot be read (fails open)", async () => {
    // Deliberately the opposite of the missing-row case: refusing to pay a whole workforce because
    // of a config read error is a worse outcome than the gap it leaves. Every withheld employee is
    // still reported by name at run validation, so a gate that is off is visible.
    execute.mockRejectedValueOnce(new Error("ER_NO_SUCH_TABLE"));

    expect((await nocReleaseStatusForEmployee("emp-1")).blocked).toBe(false);
  });
});

describe("nocReleaseClearedSql", () => {
  it("treats active employees, completed cases and overrides as cleared", () => {
    const sql = nocReleaseClearedSql("e");
    expect(sql).toContain("employment_status");
    expect(sql).toContain("'completed'");
    expect(sql).toContain("override_at IS NOT NULL");
  });

  it("honours the table alias it is given", () => {
    // Inlined into the NEFT payable query, which aliases employees as `e`. A hardcoded alias here
    // would produce a query that either fails or silently references the wrong table.
    expect(nocReleaseClearedSql("emp")).toContain("emp.id");
    expect(nocReleaseClearedSql("emp")).not.toContain("e.id");
  });
});
