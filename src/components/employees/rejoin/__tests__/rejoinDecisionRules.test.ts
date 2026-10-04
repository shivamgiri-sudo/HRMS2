import { describe, expect, it } from "vitest";
import { MIN_ABSCONDING_REMARKS, MIN_REMARKS, decide, type DecisionInput } from "../rejoinDecisionRules";

const eligible: DecisionInput["eligibility"] = { status: "eligible", reasons: [], requiresAbscondingAck: false };
const absconder: DecisionInput["eligibility"] = {
  status: "review",
  reasons: [{ code: "ABSCONDING", severity: "review", message: "Left by absconding; the branch head must acknowledge and give remarks." }],
  requiresAbscondingAck: true,
};
const blocked: DecisionInput["eligibility"] = {
  status: "blocked",
  reasons: [
    { code: "ABSCONDING", severity: "review", message: "Left by absconding." },
    { code: "TERMINATED", severity: "blocked", message: "Left through termination; rejoining is not allowed." },
    { code: "GAP_EXCEEDS_30", severity: "blocked", message: "Gap exceeds 30 days." },
  ],
  requiresAbscondingAck: true,
};

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  requestStatus: "pending",
  eligibility: eligible,
  remarks: "Good record, approve.",
  abscondingAcknowledged: false,
  ...over,
});

describe("decide", () => {
  it("backend minimums", () => {
    expect(MIN_REMARKS).toBe(5);
    expect(MIN_ABSCONDING_REMARKS).toBe(20);
  });

  it("eligible + remarks >= 5: both enabled", () => {
    const d = decide(input({ remarks: "okay." }));
    expect(d).toMatchObject({ canApprove: true, canReject: true, approveReason: null, rejectReason: null, needsAck: false, approveMinRemarks: 5 });
  });

  it("review (not absconding) behaves like eligible", () => {
    const d = decide(input({ eligibility: { status: "review", reasons: [{ code: "OPEN_CLEARANCE", severity: "review", message: "x" }], requiresAbscondingAck: false } }));
    expect(d.canApprove).toBe(true);
    expect(d.canReject).toBe(true);
  });

  it.each(["approved", "rejected", "cancelled", "branch_head_approved", ""])("request status %j: both disabled with a reason", (status) => {
    const d = decide(input({ requestStatus: status, remarks: "a long enough remark here, really" }));
    expect(d.canApprove).toBe(false);
    expect(d.canReject).toBe(false);
    expect(d.approveReason).toMatch(/no longer pending/);
    expect(d.rejectReason).toMatch(/no longer pending/);
  });

  it("remarks shorter than 5 after trimming: both disabled, with a counter", () => {
    const d = decide(input({ remarks: "  abc   " }));
    expect(d.canApprove).toBe(false);
    expect(d.canReject).toBe(false);
    expect(d.rejectReason).toContain("(3/5)");
    expect(d.approveReason).toContain("(3/5)");
  });

  it("exactly 5 trimmed characters is enough", () => {
    const d = decide(input({ remarks: " abcde " }));
    expect(d.canApprove).toBe(true);
    expect(d.canReject).toBe(true);
  });

  it("blocked: Approve disabled naming the first blocked reason, Reject allowed", () => {
    const d = decide(input({ eligibility: blocked, abscondingAcknowledged: true, remarks: "x".repeat(40) }));
    expect(d.canApprove).toBe(false);
    expect(d.approveReason).toContain("blocked");
    expect(d.approveReason).toContain("Left through termination");
    expect(d.approveReason).not.toContain("Gap exceeds");
    expect(d.canReject).toBe(true);
    expect(d.rejectReason).toBeNull();
  });

  it("blocked with no blocked reason listed still disables Approve", () => {
    const d = decide(input({ eligibility: { status: "blocked", reasons: [], requiresAbscondingAck: false } }));
    expect(d.canApprove).toBe(false);
    expect(d.approveReason).toMatch(/blocked/i);
    expect(d.canReject).toBe(true);
  });

  it("blocked with short remarks: Reject still needs 5", () => {
    const d = decide(input({ eligibility: blocked, remarks: "no" }));
    expect(d.canReject).toBe(false);
    expect(d.rejectReason).toContain("(2/5)");
  });

  describe("absconding (requiresAbscondingAck)", () => {
    it("shows the checkbox and raises Approve's minimum to 20", () => {
      const d = decide(input({ eligibility: absconder }));
      expect(d.needsAck).toBe(true);
      expect(d.approveMinRemarks).toBe(20);
    });

    it("without the acknowledgement Approve is disabled even with long remarks", () => {
      const d = decide(input({ eligibility: absconder, remarks: "x".repeat(30), abscondingAcknowledged: false }));
      expect(d.canApprove).toBe(false);
      expect(d.approveReason).toMatch(/acknowledgement/);
      expect(d.canReject).toBe(true);
    });

    it("acknowledged but remarks under 20: Approve disabled with a 20-char counter; Reject only needs 5", () => {
      const d = decide(input({ eligibility: absconder, remarks: "  twelve chars  ", abscondingAcknowledged: true }));
      expect(d.canApprove).toBe(false);
      expect(d.approveReason).toContain("(12/20)");
      expect(d.canReject).toBe(true);
    });

    it("acknowledged and remarks >= 20 (trimmed): Approve enabled", () => {
      const d = decide(input({ eligibility: absconder, remarks: ` ${"y".repeat(20)} `, abscondingAcknowledged: true }));
      expect(d.canApprove).toBe(true);
      expect(d.approveReason).toBeNull();
    });

    it("19 trimmed characters is not enough", () => {
      const d = decide(input({ eligibility: absconder, remarks: "y".repeat(19), abscondingAcknowledged: true }));
      expect(d.canApprove).toBe(false);
    });
  });
});
