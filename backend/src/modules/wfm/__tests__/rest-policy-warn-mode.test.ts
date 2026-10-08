import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Owner ruling 2026-08-16 (decision 2): build WARN mode first, activate 11 hours in WARN, never
 * switch straight to BLOCK.
 *
 * In WARN a rest shortfall must ALLOW the roster write but persist a REST_GAP_WARNING carrying
 * the actual rest against the required rest, identifying the conflicting neighbouring
 * assignment, and surfaced to WFM review. It must not silently disappear. Enforcement must not
 * be weakened separately in generation, manual assignment or bulk upload.
 *
 * Context: wfm_rest_policy is EMPTY in production, which is why roster generation currently
 * fails closed with REST_POLICY_MISSING. Once migration 1224 is applied and an 11-hour
 * organisation policy is seeded in WARN, generation unblocks and the 139 NOIDA-2 turnarounds
 * surface as warnings to remediate before the same row is flipped to BLOCK.
 */

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mockExecute, getConnection: vi.fn() } }));

const { applyRestDecision } = await import("../rest-policy.service.js");

const SRC = readFileSync(resolve(__dirname, "../rest-policy.service.ts"), "utf8");

const policy = (mode: "warn" | "block") => ({
  id: "pol-1",
  scopeType: "organization" as const,
  scopeId: null,
  minimumRestMinutes: 660,
  allowsEmergencyOverride: false,
  enforcementMode: mode,
});

const shortfall = (mode: "warn" | "block") => ({
  ok: false as const,
  reason: "INSUFFICIENT_REST" as const,
  against: "previous" as const,
  neighborShift: { date: "2026-08-16", time: "06:00" },
  actualRestMinutes: 420,
  requiredRestMinutes: 660,
  policy: policy(mode),
  canOverride: false,
});

const ctx = { employeeId: "emp-1", rosterDate: "2026-08-17" };

beforeEach(() => mockExecute.mockReset().mockResolvedValue([{ affectedRows: 1 }, []]));

describe("WARN allows the write and records the shortfall", () => {
  it("allows a shortfall through in WARN", async () => {
    const decision = await applyRestDecision(shortfall("warn") as never, ctx);
    expect(decision).toEqual({ allowed: true, warned: true });
  });

  it("persists a REST_GAP_WARNING rather than only logging it", async () => {
    await applyRestDecision(shortfall("warn") as never, ctx);
    const insert = mockExecute.mock.calls.find(([s]) => /INSERT INTO wfm_roster_conflict_log/.test(String(s)));
    expect(insert, "no REST_GAP_WARNING was written").toBeTruthy();
    expect(String(insert![0])).toMatch(/'REST_GAP_WARNING'/);
  });

  it("carries the actual rest, the requirement, and the shortfall", async () => {
    await applyRestDecision(shortfall("warn") as never, ctx);
    const insert = mockExecute.mock.calls.find(([s]) => /wfm_roster_conflict_log/.test(String(s)));
    const message = (insert![1] as unknown[]).find((p) => typeof p === "string" && p.includes("rest")) as string;
    expect(message).toMatch(/420 min rest/);
    expect(message).toMatch(/requires 660 min/);
    expect(message).toMatch(/short by 240 min/);
  });

  it("identifies the conflicting neighbouring assignment", async () => {
    await applyRestDecision(shortfall("warn") as never, ctx);
    const insert = mockExecute.mock.calls.find(([s]) => /wfm_roster_conflict_log/.test(String(s)));
    const message = (insert![1] as unknown[]).find((p) => typeof p === "string" && p.includes("rest")) as string;
    expect(message).toMatch(/previous shift/);
    expect(message).toMatch(/2026-08-16 06:00/);
  });

  it("lands in the WFM review queue as open and high, not informational", async () => {
    // A warned-through breach is something somebody chose to accept and must return to.
    await applyRestDecision(shortfall("warn") as never, ctx);
    const insert = mockExecute.mock.calls.find(([s]) => /wfm_roster_conflict_log/.test(String(s)));
    expect(String(insert![0])).toMatch(/'high'/);
    expect(String(insert![0])).toMatch(/'open'/);
  });
});

describe("BLOCK still refuses, and WARN never loosens what it should not", () => {
  it("refuses a shortfall in BLOCK and writes no warning", async () => {
    const decision = await applyRestDecision(shortfall("block") as never, ctx);
    expect(decision).toEqual({ allowed: false, warned: false });
    expect(mockExecute.mock.calls.some(([s]) => /wfm_roster_conflict_log/.test(String(s)))).toBe(false);
  });

  it("blocks REST_POLICY_MISSING regardless of mode", async () => {
    // There is no policy to be lenient about. A caller that cannot determine the rule must
    // never write, so this is not warnable even if some policy elsewhere says warn.
    const decision = await applyRestDecision(
      { ok: false, reason: "REST_POLICY_MISSING", policy: null } as never,
      ctx,
    );
    expect(decision).toEqual({ allowed: false, warned: false });
  });

  it("passes a compliant roster straight through with no warning", async () => {
    const decision = await applyRestDecision(
      { ok: true, requiredRestMinutes: 660, policy: policy("warn") } as never,
      ctx,
    );
    expect(decision).toEqual({ allowed: true, warned: false });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("treats an unknown or absent mode as block", async () => {
    // A database that has not taken migration 1224 returns undefined here.
    const decision = await applyRestDecision(
      { ...shortfall("block"), policy: { ...policy("block"), enforcementMode: undefined } } as never,
      ctx,
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("one decision point, obeyed by every roster write path", () => {
  it("the mode defaults to block when the column is missing", () => {
    expect(SRC).toMatch(/enforcement_mode \?\? ""\)\.toLowerCase\(\) === "warn" \? "warn" : "block"/);
  });

  it("all four write paths call the shared decision rather than reading the mode", () => {
    const paths = [
      "../../roster/roster-generation.service.ts",
      "../auto-roster-synced.service.ts",
      "../../bulk-upload/shift-roster-bulk.service.ts",
    ];
    for (const p of paths) {
      const body = readFileSync(resolve(__dirname, p), "utf8");
      expect(body, `${p} does not consult applyRestDecision`).toMatch(/applyRestDecision\(/);
      // Property ACCESS, not the word — the comment in each path names enforcementMode to
      // explain why it deliberately does not read it.
      expect(body, `${p} reads the mode itself instead of asking the resolver`)
        .not.toMatch(/\.enforcementMode/);
    }
  });
});
