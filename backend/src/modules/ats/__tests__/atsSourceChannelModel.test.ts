import { describe, expect, it } from "vitest";
import { canonicalChannel, normaliseChannels } from "../ats-source-channel-model.js";

/**
 * Exact sourcing_channel distribution over the 7,760 genuine candidates, production
 * 2026-08-11. Tested against reality rather than an idealised list.
 */
const PRODUCTION_CHANNELS = [
  { channel: "WALKIN", count: 3564 },
  { channel: "", count: 2741 },
  { channel: "Recruiter", count: 952 },
  { channel: "Walk-In", count: 346 },
  { channel: "Reference", count: 134 },
  { channel: "Employee Referral", count: 10 },
  { channel: "CODEX_E2E_TEST", count: 7 },
  { channel: "Other", count: 3 },
  { channel: "TEST DEMO", count: 3 },
  { channel: "LinkedIn", count: 2 },
  { channel: "Job Portal", count: 1 },
  { channel: "Referral", count: 1 },
  { channel: "Naukri", count: 1 },
  { channel: "Direct Application", count: 1 },
];

describe("canonicalChannel", () => {
  it("maps every value present in production", () => {
    const unmapped = PRODUCTION_CHANNELS.filter((c) => canonicalChannel(c.channel) === null);
    expect(unmapped.map((c) => c.channel)).toEqual([]);
  });

  it("merges WALKIN and Walk-In, which are one channel spelled two ways", () => {
    expect(canonicalChannel("WALKIN")).toBe("walk_in");
    expect(canonicalChannel("Walk-In")).toBe("walk_in");
    expect(canonicalChannel("walk in")).toBe("walk_in");
  });

  it("merges the three referral spellings", () => {
    for (const raw of ["Reference", "Referral", "Employee Referral"]) {
      expect(canonicalChannel(raw)).toBe("referral");
    }
  });

  it("keeps test data as its own bucket rather than blending it into a real channel", () => {
    expect(canonicalChannel("CODEX_E2E_TEST")).toBe("test_data");
    expect(canonicalChannel("TEST DEMO")).toBe("test_data");
  });

  it("treats a blank as 'unspecified' rather than dropping it", () => {
    // 2,741 genuine candidates carry no channel — 35% of them. A report that omits a third of
    // its population silently is worse than one that shows the gap.
    expect(canonicalChannel("")).toBe("unspecified");
    expect(canonicalChannel("   ")).toBe("unspecified");
  });

  it("returns null for an unrecognised value so the caller can surface it", () => {
    expect(canonicalChannel("Some New Job Board")).toBeNull();
    expect(canonicalChannel(null)).toBeNull();
  });
});

describe("normaliseChannels", () => {
  const out = normaliseChannels(PRODUCTION_CHANNELS);

  it("conserves the total — merging must not lose or duplicate candidates", () => {
    const before = PRODUCTION_CHANNELS.reduce((n, c) => n + c.count, 0);
    const after = out.channels.reduce((n, c) => n + c.count, 0);
    expect(after).toBe(before);
  });

  it("reports walk-in as one channel of 3,910, not two of 3,564 and 346", () => {
    const walkIn = out.channels.find((c) => c.channel === "walk_in")!;
    expect(walkIn.count).toBe(3564 + 346);
    expect(walkIn.merged_from).toEqual(expect.arrayContaining(["WALKIN", "Walk-In"]));
  });

  it("reports referral as one channel of 145", () => {
    const referral = out.channels.find((c) => c.channel === "referral")!;
    expect(referral.count).toBe(134 + 10 + 1);
  });

  it("records what was merged, so a surprising number can be traced back", () => {
    for (const ch of out.channels) {
      expect(ch.merged_from.length).toBeGreaterThan(0);
    }
  });

  it("orders by volume", () => {
    const counts = out.channels.map((c) => c.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("surfaces unrecognised values instead of absorbing them into 'other'", () => {
    const res = normaliseChannels([
      { channel: "WALKIN", count: 5 },
      { channel: "Some New Job Board", count: 9 },
    ]);
    expect(res.unmapped).toEqual([{ channel: "Some New Job Board", count: 9 }]);
    expect(res.channels.find((c) => c.channel === "other")).toBeUndefined();
  });
});
