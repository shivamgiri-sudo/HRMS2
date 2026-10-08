import { describe, expect, it } from "vitest";
import {
  buildTimeline, isEscalatedRaw, isOpenStatus, normalizeLeaveStatus, statusLabel,
} from "./leaveStatus";

describe("normalizeLeaveStatus", () => {
  it.each([
    ["pending", "pending"],
    ["pending_branch_head", "escalated"],
    ["approved", "approved"],
    ["branch_head_approved", "approved"],
    ["rejected", "rejected"],
    ["branch_head_rejected", "rejected"],
    ["cancelled", "cancelled"],
    ["lapsed", "lapsed"],
    ["discarded", "discarded"],
    ["something_new", "pending"],
    ["", "pending"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeLeaveStatus(raw)).toBe(expected);
  });
});

describe("isOpenStatus / statusLabel", () => {
  it("treats pending and escalated as open, nothing else", () => {
    expect(isOpenStatus("pending")).toBe(true);
    expect(isOpenStatus("escalated")).toBe(true);
    for (const s of ["approved", "rejected", "cancelled", "lapsed", "discarded"] as const) expect(isOpenStatus(s)).toBe(false);
  });
  it("labels escalated requests in words", () => {
    expect(statusLabel("escalated")).toBe("Awaiting Branch Head");
    expect(statusLabel("lapsed")).toBe("Lapsed");
  });
});

describe("isEscalatedRaw", () => {
  it("is true for every branch-head tier status", () => {
    for (const s of ["pending_branch_head", "branch_head_approved", "branch_head_rejected"]) expect(isEscalatedRaw(s)).toBe(true);
    for (const s of ["pending", "approved", "rejected", "cancelled"]) expect(isEscalatedRaw(s)).toBe(false);
  });
});

const base = { submittedAt: "2026-10-01T09:00:00", reviewedBy: "Asha Rao", reviewedAt: "2026-10-02T10:00:00" };

describe("buildTimeline", () => {
  const states = (t: ReturnType<typeof buildTimeline>) => t.map((s) => `${s.key}:${s.state}`);

  it("pending: submitted done, manager current, decision upcoming, no branch-head step", () => {
    expect(states(buildTimeline({ ...base, status: "pending" }))).toEqual([
      "submitted:done", "review:current", "decision:upcoming",
    ]);
  });

  it("approved by the manager: all done, decision names the reviewer", () => {
    const t = buildTimeline({ ...base, status: "approved" });
    expect(states(t)).toEqual(["submitted:done", "review:done", "decision:done"]);
    expect(t[2].label).toBe("Approved");
    expect(t[2].detail).toContain("Asha Rao");
  });

  it("rejected: decision is marked rejected", () => {
    const t = buildTimeline({ ...base, status: "rejected" });
    expect(t.at(-1)).toMatchObject({ key: "decision", state: "rejected", label: "Rejected" });
  });

  it("escalated and still waiting: manager step skipped, branch head current", () => {
    expect(states(buildTimeline({ ...base, status: "pending_branch_head" }))).toEqual([
      "submitted:done", "review:skipped", "branch_head:current", "decision:upcoming",
    ]);
  });

  it("escalated and approved by the branch head", () => {
    expect(states(buildTimeline({ ...base, status: "branch_head_approved" }))).toEqual([
      "submitted:done", "review:skipped", "branch_head:done", "decision:done",
    ]);
  });

  it("cancelled: decision shows cancelled and the open steps are not left 'current'", () => {
    const t = buildTimeline({ ...base, status: "cancelled" });
    expect(t.some((s) => s.state === "current")).toBe(false);
    expect(t.at(-1)).toMatchObject({ key: "decision", label: "Cancelled" });
  });

  it("lapsed is terminal with its own label", () => {
    expect(buildTimeline({ ...base, status: "lapsed" }).at(-1)).toMatchObject({ label: "Lapsed" });
  });
});
