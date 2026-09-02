import { describe, it, expect } from "vitest";
import { summarizeOverrunList, VALIDATION_MESSAGE_MAX } from "../grn-smart.service.js";

/**
 * grn_validation_result.message is VARCHAR(500). POOLED_LINE_SHARE used to build it by joining
 * one full sentence per cost centre over its defined share of a branch-common line, with no cap
 * -- reported live 2026-09-02: raising a GRN against a pooled line with several cost centres
 * already over share failed outright with "Data too long for column 'message' at row 1", so the
 * GRN could not be raised at all, not just displayed oddly.
 */

function row(name: string, drawn: number, share: number) {
  return { costCentreName: name, head: "Communication & Connectivity / Company Owned Data", definedShare: share, totalDraw: drawn };
}

describe("summarizeOverrunList", () => {
  it("stays a plain join for a small overrun list, unchanged from before", () => {
    const out = summarizeOverrunList([row("NOIDA-2", 12000, 10000)]);
    expect(out).toBe(
      "NOIDA-2 has now drawn 12000.00 from the branch-common Communication & Connectivity / Company Owned Data line against a planned share of 10000.00"
    );
    expect(out.length).toBeLessThan(VALIDATION_MESSAGE_MAX);
  });

  it("never exceeds the real column limit — the exact live failure, reproduced", () => {
    // Each sentence here runs ~150 chars; 8 of them joined is comfortably over 500, which is
    // exactly the shape of the branch-common pool this warning was built for (58 of 128 active
    // lines are pooled — more than a couple of cost centres drawing from one at once is routine,
    // not an edge case).
    const overrun = Array.from({ length: 8 }, (_, i) =>
      row(`Cost Centre ${String(i + 1).padStart(3, "0")} — a genuinely long real display name`, 15000 + i * 137, 10000)
    );
    const unbounded = overrun
      .map((r) => `${r.costCentreName} has now drawn ${r.totalDraw.toFixed(2)} from the branch-common ${r.head} line against a planned share of ${r.definedShare.toFixed(2)}`)
      .join("; ");
    expect(unbounded.length).toBeGreaterThan(500); // confirms the scenario is real, not contrived

    const out = summarizeOverrunList(overrun);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.length).toBeLessThanOrEqual(VALIDATION_MESSAGE_MAX);
  });

  it("names how many were left out, rather than silently dropping them", () => {
    const overrun = Array.from({ length: 8 }, (_, i) => row(`Cost Centre ${i + 1}`, 15000, 10000));
    const out = summarizeOverrunList(overrun);
    expect(out).toMatch(/\+\d+ more/);
  });

  it("never cuts a sentence off mid-word — every kept segment is a complete, verbatim sentence", () => {
    const overrun = Array.from({ length: 10 }, (_, i) =>
      row(`Cost Centre With A Fairly Long Real Name Number ${i + 1}`, 20000, 10000)
    );
    const fullSentences = overrun.map(
      (r) => `${r.costCentreName} has now drawn ${r.totalDraw.toFixed(2)} from the branch-common ${r.head} line against a planned share of ${r.definedShare.toFixed(2)}`
    );
    const out = summarizeOverrunList(overrun);
    const segments = out.replace(/; \+\d+ more$/, "").split("; ").filter(Boolean);
    for (const seg of segments) {
      expect(fullSentences).toContain(seg);
    }
    // And it actually exercised the truncation path — not a no-op that happened to pass.
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length).toBeLessThan(overrun.length);
  });

  it("keeps every full sentence when the whole list already fits", () => {
    const overrun = [row("A", 12000, 10000), row("B", 13000, 10000)];
    const out = summarizeOverrunList(overrun);
    expect(out).not.toMatch(/more/);
    expect(out).toContain("A has now drawn");
    expect(out).toContain("B has now drawn");
  });
});
