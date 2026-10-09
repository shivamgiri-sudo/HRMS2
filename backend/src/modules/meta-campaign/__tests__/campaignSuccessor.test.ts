import { describe, expect, it } from "vitest";
import { autoSuccessorOn, pickSuccessor, type Candidate } from "../campaign-successor.service.js";

const cur = { designation: "EXECUTIVE", branch: "NOIDA-2" };
const c = (o: Partial<Candidate>): Candidate => ({ id: "x", designation: "EXECUTIVE", branch: "NOIDA-2", validity: "2026-10-30", seatsLeft: 10, linked: false, ...o });

describe("pickSuccessor", () => {
  it("returns null when nothing qualifies", () => {
    expect(pickSuccessor(cur, [], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ seatsLeft: 0 })], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ designation: "MANAGER" })], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ validity: "2026-10-01" })], "2026-10-09")).toBeNull();
    expect(pickSuccessor(cur, [c({ branch: "MUMBAI" })], "2026-10-09")).toBeNull();
  });
  it("accepts the same branch family (NOIDA-2 ~ NOIDA)", () => {
    expect(pickSuccessor(cur, [c({ id: "a", branch: "NOIDA" })], "2026-10-09")?.id).toBe("a");
  });
  it("prefers a linked requisition, then the same branch, then more seats", () => {
    expect(pickSuccessor(cur, [c({ id: "a", seatsLeft: 99 }), c({ id: "b", linked: true, seatsLeft: 1 })], "2026-10-09")?.id).toBe("b");
    expect(pickSuccessor(cur, [c({ id: "a", branch: "NOIDA", seatsLeft: 99 }), c({ id: "b", seatsLeft: 1 })], "2026-10-09")?.id).toBe("b");
    expect(pickSuccessor(cur, [c({ id: "a", seatsLeft: 5 }), c({ id: "b", seatsLeft: 9 })], "2026-10-09")?.id).toBe("b");
  });
  it("an open-ended requisition (no validity) is allowed", () => {
    expect(pickSuccessor(cur, [c({ id: "a", validity: null })], "2026-10-09")?.id).toBe("a");
  });
});

describe("autoSuccessorOn", () => {
  it("is off unless the env names the campaign or says all", () => {
    expect(autoSuccessorOn("c1", {})).toBe(false);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "off" })).toBe(false);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "all" })).toBe(true);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "c9, c1" })).toBe(true);
    expect(autoSuccessorOn("c1", { META_AUTO_SUCCESSOR: "c9" })).toBe(false);
  });
});
