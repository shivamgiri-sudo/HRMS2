import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const connExecute = vi.fn();
const beginTransaction = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();
const release = vi.fn();

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: (...a: unknown[]) => execute(...a),
    getConnection: async () => ({
      execute: (...a: unknown[]) => connExecute(...a),
      beginTransaction, commit, rollback, release,
    }),
  },
}));

const {
  ALLOWED_TRANSITIONS, canTransition, assertTransitionAllowed,
  recordSimulationReview, submitForApproval, approveTarget, rejectTarget,
  activateTarget, deactivateTarget, editTarget,
} = await import("../src/modules/quality-dashboard/quality-target-transition.js");

/**
 * A quality target decides who gets coached. 1057 let a draft become active in
 * a single call, which stores a policy without defending one.
 *
 * The two rules worth stating plainly, because everything below tests one or
 * the other:
 *
 *   - an approval approves SPECIFIC NUMBERS, so moving the numbers voids it
 *   - the author is not the approver
 */

const ROW = {
  id: "t1", process_id: "p1", metric_code: "QUALITY_SCORE",
  status: "draft", effective_from: "2026-09-01", effective_to: null,
  created_by: "author-1",
  warning_threshold_pct: 90, critical_threshold_pct: 75,
  config_fingerprint: "45.0000|90.0000|75.0000|3|weekly|2026-09-01|-",
  simulated_config_fingerprint: null,
};

const rowsOf = (r: Record<string, unknown>) => [[r], []];
const affected = (n: number) => [{ affectedRows: n }, []];
const NO_ROWS = [[], []];

beforeEach(() => {
  execute.mockReset(); connExecute.mockReset();
  beginTransaction.mockReset(); commit.mockReset(); rollback.mockReset(); release.mockReset();
  beginTransaction.mockResolvedValue(undefined);
  commit.mockResolvedValue(undefined);
  rollback.mockResolvedValue(undefined);
  release.mockReturnValue(undefined);
});

describe("the transition table itself", () => {
  it("only allows the documented steps", () => {
    expect(canTransition("draft", "simulation_reviewed")).toBe(true);
    expect(canTransition("simulation_reviewed", "pending_approval")).toBe(true);
    expect(canTransition("pending_approval", "approved")).toBe(true);
    expect(canTransition("approved", "active")).toBe(true);
    expect(canTransition("active", "inactive")).toBe(true);
  });

  it("refuses to skip simulation or approval", () => {
    // The whole point: no path from draft to active that misses a review.
    expect(canTransition("draft", "active")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("simulation_reviewed", "active")).toBe(false);
    expect(canTransition("pending_approval", "active")).toBe(false);
  });

  it("treats superseded, inactive as final", () => {
    // They still explain the coaching raised while they applied, so they are
    // never revived — a revision is a new dated row.
    expect(ALLOWED_TRANSITIONS.superseded).toEqual([]);
    expect(ALLOWED_TRANSITIONS.inactive).toEqual([]);
    expect(() => assertTransitionAllowed("superseded", "active")).toThrow(/final state/);
  });

  it("lets a rejected target be revised", () => {
    expect(canTransition("rejected", "draft")).toBe(true);
  });

  it("names the legal next steps when it refuses", () => {
    // A 409 saying only "no" makes the caller guess.
    expect(() => assertTransitionAllowed("draft", "approved")).toThrow(/allowed: simulation_reviewed/);
  });
});

describe("simulation binds to the configuration it ran against", () => {
  it("copies the fingerprint in SQL rather than trusting the caller", async () => {
    connExecute.mockResolvedValueOnce(rowsOf(ROW)).mockResolvedValue(affected(1));
    await recordSimulationReview({ targetId: "t1", actorUserId: "u1", summary: { wouldTrigger: 4 } });

    const update = String(connExecute.mock.calls[1][0]);
    // If this were computed in TypeScript it could drift from the generated
    // column, and the staleness check would quietly stop meaning anything.
    expect(update).toMatch(/simulated_config_fingerprint = config_fingerprint/);
    expect(commit).toHaveBeenCalled();
  });

  it("refuses to submit when the config moved after simulating", async () => {
    // The UPDATE carries `AND simulated_config_fingerprint = config_fingerprint`,
    // so a stale row matches nothing.
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "simulation_reviewed" }))
      .mockResolvedValueOnce(affected(0));

    await expect(submitForApproval({ targetId: "t1", actorUserId: "u1" }))
      .rejects.toThrow(/changed after it was simulated/);
    expect(rollback).toHaveBeenCalled();
  });

  it("refuses to approve a stale simulation", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }))
      .mockResolvedValueOnce(affected(0));

    await expect(approveTarget({ targetId: "t1", approverUserId: "approver-9" }))
      .rejects.toThrow(/changed after it was simulated/);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("separation of duties", () => {
  it("stops the author approving their own target", async () => {
    connExecute.mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }));

    await expect(approveTarget({ targetId: "t1", approverUserId: "author-1" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(commit).not.toHaveBeenCalled();
  });

  it("allows a different approver", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }))
      .mockResolvedValue(affected(1));

    await expect(approveTarget({ targetId: "t1", approverUserId: "approver-9" }))
      .resolves.toMatchObject({ status: "approved" });
  });

  it("permits self-approval only with a recorded reason, and writes it to the row", async () => {
    // Some processes have a single quality owner. The exception is a door, not
    // a hole: it lands on the row and in the audit trail.
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }))
      .mockResolvedValue(affected(1));

    await approveTarget({
      targetId: "t1", approverUserId: "author-1",
      selfApprovalException: { reason: "Sole quality owner for this process" },
    });

    const update = connExecute.mock.calls[1];
    expect(String(update[0])).toMatch(/self_approval_exception = \?/);
    expect(update[1]).toContain("Sole quality owner for this process");

    const auditCall = connExecute.mock.calls.find(([s]) => /process_quality_target_audit/.test(String(s)));
    expect(String(auditCall?.[1]?.[5])).toMatch(/Self-approval exception/);
  });

  it("rejects an exception with a blank reason", async () => {
    connExecute.mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }));
    await expect(approveTarget({
      targetId: "t1", approverUserId: "author-1", selfApprovalException: { reason: "   " },
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("activation", () => {
  it("takes a row lock before reading the incumbent", async () => {
    // Without it two concurrent activations each see no incumbent and both go
    // active, which is the one state the whole table exists to prevent.
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "approved" }))
      .mockResolvedValueOnce(NO_ROWS)
      .mockResolvedValue(affected(1));

    await activateTarget({ targetId: "t1", actorUserId: "u1" });
    expect(String(connExecute.mock.calls[0][0])).toMatch(/FOR UPDATE/);
    expect(String(connExecute.mock.calls[1][0])).toMatch(/FOR UPDATE/);
  });

  it("closes the incumbent the day before the new one starts", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "approved" }))
      .mockResolvedValueOnce([[{ id: "old", effective_from: "2026-01-01", effective_to: null }], []])
      .mockResolvedValue(affected(1));

    const result = await activateTarget({ targetId: "t1", actorUserId: "u1" });
    expect(result.supersededId).toBe("old");

    const closing = connExecute.mock.calls.find(([s]) => /status = 'superseded'/.test(String(s)));
    expect(String(closing?.[0])).toMatch(/DATE_SUB\(\?, INTERVAL 1 DAY\)/);
  });

  it("refuses when the incumbent starts on or after the newcomer", async () => {
    // Closing it "the day before" would hand it a negative window.
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "approved" }))
      .mockResolvedValueOnce([[{ id: "old", effective_from: "2026-09-01", effective_to: null }], []]);

    await expect(activateTarget({ targetId: "t1", actorUserId: "u1" }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(rollback).toHaveBeenCalled();
  });

  it("rolls back the supersede when activation writes nothing", async () => {
    // Otherwise the old policy is closed, the new one never opens, and the
    // process is governed by nothing at all.
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "approved" }))
      .mockResolvedValueOnce([[{ id: "old", effective_from: "2026-01-01", effective_to: null }], []])
      .mockResolvedValueOnce(affected(1))   // supersede
      .mockResolvedValueOnce(affected(1))   // its audit row
      .mockResolvedValueOnce(affected(0));  // activation matched nothing

    await expect(activateTarget({ targetId: "t1", actorUserId: "u1" })).rejects.toThrow();
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("only activates a row that is still approved and still unmodified", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "approved" }))
      .mockResolvedValueOnce(NO_ROWS)
      .mockResolvedValue(affected(1));

    await activateTarget({ targetId: "t1", actorUserId: "u1" });
    const activation = connExecute.mock.calls.find(
      ([s]) => /UPDATE process_quality_target/.test(String(s)) && /SET status = 'active'/.test(String(s)),
    );
    expect(String(activation?.[0])).toMatch(/AND status = 'approved'/);
    expect(String(activation?.[0])).toMatch(/simulated_config_fingerprint = config_fingerprint/);
  });

  it("will not activate something that was never approved", async () => {
    connExecute.mockResolvedValueOnce(rowsOf({ ...ROW, status: "simulation_reviewed" }));
    await expect(activateTarget({ targetId: "t1", actorUserId: "u1" }))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("editing voids what referred to the old numbers", () => {
  it("returns the row to draft and clears simulation and approval", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }))
      .mockResolvedValue(affected(1));

    const result = await editTarget({
      targetId: "t1", actorUserId: "u1", changes: { targetScore: 55 },
    });
    expect(result.status).toBe("draft");

    const update = String(connExecute.mock.calls[1][0]);
    expect(update).toMatch(/status = 'draft'/);
    expect(update).toMatch(/simulated_config_fingerprint = NULL/);
    expect(update).toMatch(/approved_by = NULL/);
    expect(update).toMatch(/self_approval_exception = 0/);
  });

  it("refuses to edit a live or historical target", async () => {
    for (const status of ["active", "superseded", "inactive"]) {
      connExecute.mockReset();
      connExecute.mockResolvedValueOnce(rowsOf({ ...ROW, status }));
      await expect(editTarget({ targetId: "t1", actorUserId: "u1", changes: { targetScore: 55 } }))
        .rejects.toThrow(/clone it instead/);
    }
  });

  it("still refuses inverted bands", async () => {
    connExecute.mockResolvedValueOnce(rowsOf(ROW));
    await expect(editTarget({
      targetId: "t1", actorUserId: "u1",
      changes: { warningThresholdPct: 60, criticalThresholdPct: 80 },
    })).rejects.toThrow(/warning threshold must sit above/);
  });
});

describe("rejection and deactivation", () => {
  it("requires a reason to reject", async () => {
    await expect(rejectTarget({ targetId: "t1", actorUserId: "u1", reason: "  " }))
      .rejects.toThrow(/must say why/);
  });

  it("records the reason on the row and in the audit", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }))
      .mockResolvedValue(affected(1));

    await rejectTarget({ targetId: "t1", actorUserId: "u1", reason: "Target below last quarter's floor" });
    const auditCall = connExecute.mock.calls.find(([s]) => /_audit/.test(String(s)));
    expect(auditCall?.[1]).toContain("Target below last quarter's floor");
  });

  it("deactivates without deleting, so coaching evidence survives", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "active" }))
      .mockResolvedValue(affected(1));

    await deactivateTarget({ targetId: "t1", actorUserId: "u1", reason: "Process closed" });
    const update = String(connExecute.mock.calls[1][0]);
    expect(update).toMatch(/status = 'inactive'/);
    expect(update).not.toMatch(/DELETE/);
  });

  it("requires a reason to deactivate", async () => {
    await expect(deactivateTarget({ targetId: "t1", actorUserId: "u1", reason: "" }))
      .rejects.toThrow(/Say why/);
  });
});

describe("every transition leaves a trace", () => {
  it("writes an audit row naming the actor and both states", async () => {
    connExecute
      .mockResolvedValueOnce(rowsOf({ ...ROW, status: "pending_approval" }))
      .mockResolvedValue(affected(1));

    await approveTarget({ targetId: "t1", approverUserId: "approver-9", note: "Agreed with ops" });

    const auditCall = connExecute.mock.calls.find(([s]) => /process_quality_target_audit/.test(String(s)));
    const params = auditCall?.[1] as unknown[];
    expect(params[2]).toBe("approved");
    expect(String(params[3])).toMatch(/pending_approval/);  // before
    expect(String(params[4])).toMatch(/approved/);          // after
    expect(params[6]).toBe("approver-9");                   // actor
  });
});
