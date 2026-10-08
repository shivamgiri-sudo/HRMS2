/**
 * Change-type governance and the kill switches.
 *
 * The failures these guard against are all the same shape: something absent being read as
 * something permitted. An empty policy table meaning "no approval needed", a missing
 * approval row meaning "approved", a missing config row meaning "enabled". Each is tested
 * explicitly, because each is what this codebase does by default when nobody stops it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/mysql.js";
import { changeTypeGate, requirementsFor, switchEnabled, readConfig } from "../uat-governance.service.js";

const mockQuery = db.query as unknown as ReturnType<typeof vi.fn>;

const POLICY = {
  bug: [{ change_type: "bug", required_role: "uat_tech_reviewer", rationale: "r" }],
  enhancement: [
    { change_type: "enhancement", required_role: "uat_product_owner", rationale: "r" },
    { change_type: "enhancement", required_role: "uat_tech_reviewer", rationale: "r" },
  ],
  policy_change: [
    { change_type: "policy_change", required_role: "uat_domain_owner", rationale: "r" },
    { change_type: "policy_change", required_role: "uat_product_owner", rationale: "r" },
    { change_type: "policy_change", required_role: "uat_tech_reviewer", rationale: "r" },
  ],
  unclear: [{ change_type: "unclear", required_role: "uat_triage", rationale: "r" }],
} as const;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([[], []]);
});

describe("requirementsFor", () => {
  it("refuses an empty policy rather than requiring nobody", async () => {
    // An empty table is the most permissive possible answer arrived at by accident.
    mockQuery.mockResolvedValueOnce([[], []]);
    await expect(requirementsFor("enhancement")).rejects.toThrow(
      /refusing to treat an empty policy/i
    );
  });

  it("returns every role a change type demands", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.policy_change, []]);
    const req = await requirementsFor("policy_change");
    expect(req.map((r) => r.requiredRole)).toEqual([
      "uat_domain_owner",
      "uat_product_owner",
      "uat_tech_reviewer",
    ]);
  });
});

describe("changeTypeGate", () => {
  it("blocks an unclassified item — CG-01", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.unclear, []]);
    const gate = await changeTypeGate("fb-1", null);
    expect(gate.blocked).toBe(true);
    expect(gate.satisfied).toBe(false);
    expect(gate.reason).toMatch(/CG-01/);
  });

  it("treats 'unclear' as blocked, not as a third outcome that proceeds", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.unclear, []]);
    const gate = await changeTypeGate("fb-1", "unclear");
    expect(gate.blocked).toBe(true);
  });

  it("treats a role with NO approval row as pending, never as satisfied", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.enhancement, []]);
    mockQuery.mockResolvedValueOnce([[], []]); // no approvals recorded at all
    const gate = await changeTypeGate("fb-1", "enhancement");
    expect(gate.satisfied).toBe(false);
    expect(gate.pending).toEqual(["uat_product_owner", "uat_tech_reviewer"]);
  });

  it("is not satisfied while one of several roles is still outstanding", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.policy_change, []]);
    mockQuery.mockResolvedValueOnce([
      [
        { required_role: "uat_domain_owner", decision: "approved" },
        { required_role: "uat_product_owner", decision: "approved" },
        // uat_tech_reviewer has not decided.
      ],
      [],
    ]);
    const gate = await changeTypeGate("fb-1", "policy_change");
    expect(gate.satisfied).toBe(false);
    expect(gate.pending).toEqual(["uat_tech_reviewer"]);
  });

  it("blocks when any required role refused, even if the others approved", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.enhancement, []]);
    mockQuery.mockResolvedValueOnce([
      [
        { required_role: "uat_product_owner", decision: "rejected" },
        { required_role: "uat_tech_reviewer", decision: "approved" },
      ],
      [],
    ]);
    const gate = await changeTypeGate("fb-1", "enhancement");
    expect(gate.blocked).toBe(true);
    expect(gate.satisfied).toBe(false);
    expect(gate.rejected).toEqual(["uat_product_owner"]);
  });

  it("is satisfied only when every required role approved", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.enhancement, []]);
    mockQuery.mockResolvedValueOnce([
      [
        { required_role: "uat_product_owner", decision: "approved" },
        { required_role: "uat_tech_reviewer", decision: "approved" },
      ],
      [],
    ]);
    const gate = await changeTypeGate("fb-1", "enhancement");
    expect(gate.satisfied).toBe(true);
    expect(gate.blocked).toBe(false);
  });

  it("ignores an approval for a role this change type does not require", async () => {
    // A signature from the wrong function is not a signature.
    mockQuery.mockResolvedValueOnce([POLICY.enhancement, []]);
    mockQuery.mockResolvedValueOnce([
      [{ required_role: "someone_else", decision: "approved" }],
      [],
    ]);
    const gate = await changeTypeGate("fb-1", "enhancement");
    expect(gate.satisfied).toBe(false);
    expect(gate.pending).toEqual(["uat_product_owner", "uat_tech_reviewer"]);
  });

  it("requires more signatures for a policy change than for a bug", async () => {
    mockQuery.mockResolvedValueOnce([POLICY.bug, []]);
    mockQuery.mockResolvedValueOnce([[], []]);
    const bug = await changeTypeGate("fb-1", "bug");

    mockQuery.mockResolvedValueOnce([POLICY.policy_change, []]);
    mockQuery.mockResolvedValueOnce([[], []]);
    const policy = await changeTypeGate("fb-2", "policy_change");

    expect(policy.required.length).toBeGreaterThan(bug.required.length);
  });
});

describe("kill switches", () => {
  it("is off when the env var is not exactly 'true'", async () => {
    for (const v of [undefined, "", "false", "1", "yes", "TRUE "]) {
      const r = await switchEnabled("builds_enabled", v);
      expect(r.enabled, `env ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("is off when the DB row is missing — a missing switch is a stop, not a start", async () => {
    mockQuery.mockResolvedValueOnce([[], []]);
    const r = await switchEnabled("builds_enabled", "true");
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/missing switch is off/i);
  });

  it("is off when an operator switched the row off, even with the env var on", async () => {
    // The DB row is the instant control: the moment you most want to stop the pipeline is
    // the moment you least want to deploy.
    mockQuery.mockResolvedValueOnce([[{ config_key: "builds_enabled", config_value: "false" }], []]);
    const r = await switchEnabled("builds_enabled", "true");
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/operator/i);
  });

  it("is on only when BOTH agree", async () => {
    mockQuery.mockResolvedValueOnce([[{ config_key: "builds_enabled", config_value: "true" }], []]);
    const r = await switchEnabled("builds_enabled", "true");
    expect(r.enabled).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("does not consult the database when the env var already vetoes", async () => {
    // Cheap, but the point is ordering: an env veto is final, so no row can override it.
    const r = await switchEnabled("builds_enabled", "false");
    expect(r.enabled).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("falls back rather than throwing when a config value is absent", async () => {
    mockQuery.mockResolvedValueOnce([[], []]);
    expect(await readConfig("daily_build_cap", "5")).toBe("5");
  });
});
