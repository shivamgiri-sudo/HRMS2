import { describe, expect, it } from "vitest";
import { approveView, blockerText, overrideCheck, whyNotView, type RunPerson } from "../approvalModel";
import type { ApprovalState, WhyNotPerson } from "../selectionTypes";

const all = { read: true, edit: true, export: true, approve: true, override: true };
const now = new Date("2026-10-09T12:00:00Z"); // 17:30 IST
const state = (o: Partial<ApprovalState> = {}): ApprovalState => ({ lastRun: { runId: "run-1", at: "2026-10-09 17:00:00", versionId: "v2", counts: { picked: 2, review: 1 } },
  currentVersion: { id: "v2", versionNo: 2 }, drift: false, blocker: null, standing: [], permissions: all, ...o });
const people: RunPerson[] = [{ id: "1", maskedMobile: "98xxxxxx10", subSource: "candidate", verdict: "pass", score: 50, status: "picked", reasons: [] },
  { id: "2", maskedMobile: "97xxxxxx11", subSource: "candidate", verdict: "pass", score: 40, status: "picked", reasons: [] },
  { id: "3", maskedMobile: "96xxxxxx12", subSource: "candidate", verdict: "review", score: 0, status: "review", reasons: ["Age: not known"] }];

describe("approve bar", () => {
  it("counts, last run, version; unticked people are not approved; review only when ticked", () => {
    const v = approveView(state(), people, new Set(["2"]), new Set(["3"]), now);
    expect(v.runText).toBe("Last run 30 min ago: 2 shortlisted, 1 for review, 0 approved, 0 unticked");
    expect(v.versionText).toBe("Criteria version 2");
    expect(v.approveCount).toBe(2);
    expect(v.canApprove).toBe(true);
  });
  it("disabled with the blocker reason in words", () => {
    const v = approveView(state({ blocker: "criteria_incomplete: decide location" }), people, new Set(), new Set(), now);
    expect(v).toMatchObject({ canApprove: false, why: "Criteria incomplete: decide location, education, shift and age first" });
    expect(blockerText("Not open: requisition is past its hiring deadline")).toBe("The requisition is not open: requisition is past its hiring deadline");
    expect(approveView(state({ drift: true }), people, new Set(), new Set(), now).versionText).toBe("Criteria version 2 (changed since the last run)");
    expect(approveView(state({ lastRun: null }), [], new Set(), new Set(), now).why).toBe("Run the shortlist first");
    expect(approveView(state(), people, new Set(["1", "2"]), new Set(), now).why).toBe("Nobody is ticked");
    expect(approveView(state({ permissions: { ...all, approve: false } }), people, new Set(), new Set(), now).why).toBe("Only HR can approve shortlists");
  });
  it("only standing approvals still valid are shown", () => {
    const v = approveView(state({ standing: [{ id: "s1", validUntil: "2026-10-12 10:00:00", versionId: "v2", approvedBy: "u", approvedAt: "t" },
      { id: "s0", validUntil: "2026-10-01 10:00:00", versionId: "v1", approvedBy: "u", approvedAt: "t" }] }), people, new Set(), new Set(), now);
    expect(v.standing).toEqual([{ id: "s1", text: "Standing approval for Live Meta until 2026-10-12 10:00:00" }]);
  });
});

describe("why not shortlisted", () => {
  const person: WhyNotPerson = { person: { maskedMobile: "98xxxxxx10", fullMobileIfSearched: "9876543210", name: "Asha", sources: ["candidate"] },
    perRequisition: [{ requisitionId: "r1", code: "REQ-1", verdict: "fail", systemBlock: null, explanation: "Fails age", failed: [{ key: "age", label: "Age", outcome: "fail", actualText: "41", requiredText: "18 to 35", mode: "must", effect: "rejected" }],
      unknown: [{ key: "night_shift", label: "Night shift", outcome: "unknown", actualText: "", requiredText: "willing", mode: "must", effect: "goes to review" }],
      override: { kind: "include", reason: "Referred", actorId: "u", at: "t" }, lastDecision: { runId: "x", status: "review", versionNo: 3, at: "t" }, journey: { state: "slot_booked", requisitionId: "r1" } },
      { requisitionId: "r2", code: "REQ-2", verdict: "fail", systemBlock: "current employee", explanation: null, failed: [], unknown: [], override: null, lastDecision: null, journey: null }] };
  it("every rule written out with what the person has and what is needed", () => {
    const [a, b] = whyNotView(person);
    expect(a.headline).toBe("Not shortlisted");
    expect(a.lines).toEqual(["Fails Age: has 41, needs 18 to 35", "Unknown Night shift: goes to review"]);
    expect(a.override).toBe("HR included this person: Referred");
    expect(a.lastDecision).toBe("Last run: review under version 3");
    expect(a.journey).toBe("In follow-up: slot booked");
    expect(b.headline).toBe("Never contacted: current employee");
  });
});

describe("override reason", () => {
  it("mandatory, up to 300 characters", () => {
    expect(overrideCheck("  ")).toEqual({ ok: false, why: "A reason is required" });
    expect(overrideCheck("x".repeat(301)).ok).toBe(false);
    expect(overrideCheck("Referred by the branch head")).toEqual({ ok: true, why: null });
  });
});
